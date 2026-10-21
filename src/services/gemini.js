// gemini.js
// The AI part. Flow for one message:
//   1. send the user's message + the tool list to Gemini
//   2. if Gemini wants to call a tool (like create_task) we run it for real
//   3. send the tool result back to Gemini and repeat until it answers with normal text
// The API key stays on the server, the browser never sees it.

const { GoogleGenAI } = require("@google/genai");
const { DateTime } = require("luxon");
const db = require("../db/database");
const config = require("../config/env");
const { AppError } = require("../middleware/errorHandler");
const { tools, runTool } = require("../mcp/tools");

// stop after this many tool rounds so a confused model can't loop forever
const MAX_TOOL_ROUNDS = 6;
// how many old chat messages we give Gemini as context
const HISTORY_LIMIT = 12;

// tools that change data (the frontend refreshes itself when one of these worked)
const TOOLS_THAT_CHANGE_DATA = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "apply_schedule_suggestions",
]);

// Gemini needs the tools in this shape
const functionDeclarations = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parametersJsonSchema: tool.jsonSchema,
}));

let client = null;

function getClient() {
  if (!config.geminiEnabled) {
    throw new AppError(
      "The Gemini API key is not set. Add GEMINI_API_KEY to your .env file and restart the server. " +
        "Tasks and the planner still work without it.",
      503
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return client;
}

// ---------- the instructions we give the model ----------

// built again for every message because "today" changes
function buildSystemInstruction() {
  const now = DateTime.now().setZone(config.timezone);

  return `You are TaskPilot AI, a friendly productivity assistant inside a task planner app.
Today is ${now.toFormat("cccc, yyyy-MM-dd")}. The user's timezone is ${config.timezone}.
The workday is ${config.workdayStart} to ${config.workdayEnd}.

How to work:
- You control the app with tools. To add, change, complete, delete or schedule tasks you MUST call the tools. Never say you did something unless a tool result confirmed it.
- One message can contain several tasks. Create one task per item.
- Dates must be YYYY-MM-DD and times must be 24 hour HH:mm. Turn words like "today", "tomorrow" or "Friday" into real dates using today's date above.
- If the user talks about something for today, or gives a time without a day, use today's date as scheduled_date.
- A fixed time like "meeting at 4 PM" means start_time 16:00. Use the duration if the user gave one. If they did not, leave duration out (the app assumes 60 minutes) and mention that assumption.
- Do not invent a start time for tasks that have none. You may call suggest_schedule and offer the suggested slots, but only call apply_schedule_suggestions after the user agrees.
- Priority: high for deadlines, meetings and urgent things, low for optional things, otherwise medium. If the user states a priority, use it.
- Before changing, completing or deleting an existing task, call list_tasks to find its id. If several tasks could match, ask which one.
- After creating or moving scheduled tasks, call find_conflicts for that day and tell the user about any overlap.
- If important information is missing and you cannot make a sensible choice (which day, which task), ask ONE short question instead of guessing.
- Keep replies short, friendly and in plain text. No markdown tables.
- Do not claim to be connected to Alexa or any smart speaker.`;
}

// ---------- chat history (saved in SQLite) ----------

function getChatHistory(limit = 50) {
  const rows = db
    .prepare("SELECT role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT ?")
    .all(limit);
  return rows.reverse(); // we selected newest first, but we want oldest first
}

function clearChatHistory() {
  db.prepare("DELETE FROM chat_messages").run();
}

function saveChatMessage(role, content) {
  db.prepare("INSERT INTO chat_messages (role, content) VALUES (?, ?)").run(role, content);
}

// old messages in the format Gemini expects ("assistant" is called "model" there)
function loadHistoryForGemini() {
  const messages = getChatHistory(HISTORY_LIMIT);
  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift(); // Gemini wants the conversation to start with the user
  }
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

// ---------- helpers ----------

// short sentence for the "actions" chips in the chat (null = nothing worth showing)
function describeAction(toolName, data) {
  switch (toolName) {
    case "create_task":
      return `Created "${data.title}"`;
    case "update_task":
      return `Updated "${data.title}"`;
    case "complete_task":
      return `Completed "${data.title}"`;
    case "delete_task":
      return `Deleted "${data.title}"`;
    case "apply_schedule_suggestions":
      return `Rescheduled ${data.applied.length} task(s)`;
    default:
      return null;
  }
}

// turn a raw Gemini SDK error into something a user can understand
function explainGeminiError(error) {
  if (error instanceof AppError) {
    return error;
  }

  const status = error.status || error.code;
  const rawMessage = String(error.message || "");

  if (status === 429) {
    return new AppError("Gemini rate limit or quota reached. Wait a minute and try again, or check your quota in Google AI Studio.", 429);
  }
  if (status === 500 || status === 503) {
    return new AppError("Gemini is busy right now. Please try again in a moment.", 503);
  }
  if (status === 404) {
    return new AppError(`The Gemini model "${config.geminiModel}" was not found for this API key. Change GEMINI_MODEL in your .env file.`, 502);
  }
  if (status === 401 || status === 403 || /api key/i.test(rawMessage)) {
    return new AppError("Gemini did not accept the API key. Check GEMINI_API_KEY in your .env file.", 502);
  }
  if (status === 400) {
    return new AppError(`Gemini rejected the request: ${rawMessage.slice(0, 200)}`, 502);
  }

  console.error("Gemini error:", error);
  return new AppError("Could not get an answer from Gemini. Please try again.", 502);
}

// ---------- the main function ----------

async function chatWithAssistant(userMessage) {
  const ai = getClient(); // throws a clear error if there is no key

  const contents = [...loadHistoryForGemini(), { role: "user", parts: [{ text: userMessage }] }];
  const actions = [];
  let tasksChanged = false;
  let reply = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await ai.models.generateContent({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(),
          temperature: 0.3,
          tools: [{ functionDeclarations }],
        },
      });

      const calls = response.functionCalls;

      // no tool calls means this is the final text answer
      if (!calls || calls.length === 0) {
        reply = response.text || "";
        break;
      }

      // keep the model's own turn in the conversation (Gemini needs it for the next round)
      contents.push(response.candidates[0].content);

      const resultParts = [];
      for (const call of calls) {
        const result = runTool(call.name, call.args || {});

        if (result.ok) {
          if (TOOLS_THAT_CHANGE_DATA.has(call.name)) {
            tasksChanged = true;
          }
          const message = describeAction(call.name, result.data);
          if (message) {
            actions.push({ tool: call.name, ok: true, message });
          }
        } else {
          actions.push({ tool: call.name, ok: false, message: `${call.name} failed: ${result.error}` });
        }

        // the model reads this to know what happened
        resultParts.push({
          functionResponse: {
            name: call.name,
            response: result.ok ? { output: result.data } : { error: result.error },
          },
        });
      }

      contents.push({ role: "user", parts: resultParts });
    }
  } catch (error) {
    throw explainGeminiError(error);
  }

  if (!reply.trim()) {
    reply = actions.length > 0 ? "Done. Check the actions above." : "Sorry, I couldn't come up with an answer. Try rephrasing that.";
  }

  // save only after everything worked, so failed attempts don't fill the history
  saveChatMessage("user", userMessage);
  saveChatMessage("assistant", reply.trim());

  return { reply: reply.trim(), actions, tasks_changed: tasksChanged };
}

module.exports = {
  chatWithAssistant,
  getChatHistory,
  clearChatHistory,
};