// chat.js
// The AI assistant page and the (simulated) Alexa+ box on the MCP page.
// Both send text to POST /api/chat, the server talks to Gemini and runs the tools.

import { api } from "./api.js";
import { escapeHtml, showToast, confirmDialog, notifyTasksChanged } from "./ui.js";

const messagesBox = document.getElementById("chat-messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendButton = document.getElementById("chat-send");
const banner = document.getElementById("chat-banner");

let historyLoaded = false;
let waiting = false; // true while we wait for the server, stops double sending

// ---------- drawing messages ----------

function scrollToBottom() {
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function addMessage(role, text, { actions = [], isError = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role}`;

  const chips = actions
    .map((action) => `<span class="action-chip ${action.ok ? "" : "failed"}">${escapeHtml(action.message)}</span>`)
    .join("");

  wrapper.innerHTML = `
    <div class="bubble ${isError ? "error" : ""}">${escapeHtml(text)}</div>
    ${chips ? `<div class="action-list">${chips}</div>` : ""}`;

  messagesBox.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

// the three bouncing dots
function addTypingIndicator() {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message ai";
  wrapper.innerHTML = `<div class="bubble"><span class="typing" aria-label="TaskPilot is thinking"><span></span><span></span><span></span></span></div>`;
  messagesBox.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showWelcome() {
  addMessage(
    "ai",
    'Hi! Tell me what you need to do and I will create the tasks and plan your day. For example: "I have to finish my DSA assignment, practice coding for 2 hours, and attend a meeting at 4 PM."'
  );
}

// ---------- loading the page ----------

export async function renderChat() {
  // is the Gemini key set? if not, tell the user right away instead of failing on the first message
  try {
    const status = await api.getChatStatus();
    banner.hidden = status.gemini_configured;
    banner.textContent = status.gemini_configured
      ? ""
      : "The Gemini API key is not set, so the AI chat is switched off. Add GEMINI_API_KEY to your .env file and restart the server. Tasks and the planner still work.";
  } catch (error) {
    banner.hidden = true;
  }

  // load saved messages only once, otherwise switching pages would wipe the "action" chips
  if (historyLoaded) {
    scrollToBottom();
    return;
  }

  try {
    const history = await api.getChatHistory();
    messagesBox.innerHTML = "";
    if (history.length === 0) {
      showWelcome();
    }
    history.forEach((message) => addMessage(message.role === "assistant" ? "ai" : "user", message.content));
    historyLoaded = true;
  } catch (error) {
    messagesBox.innerHTML = "";
    addMessage("ai", `I could not load the old messages: ${error.message}`, { isError: true });
  }
}

// ---------- sending ----------

async function sendMessage(text) {
  const message = text.trim();
  if (!message || waiting) {
    return;
  }

  waiting = true;
  sendButton.disabled = true;
  input.value = "";
  addMessage("user", message);
  const typing = addTypingIndicator();

  try {
    const result = await api.sendChat(message);
    typing.remove();
    addMessage("ai", result.reply, { actions: result.actions });
    if (result.tasks_changed) {
      notifyTasksChanged();
    }
  } catch (error) {
    typing.remove();
    addMessage("ai", error.message, { isError: true });
  } finally {
    waiting = false;
    sendButton.disabled = false;
    input.focus();
  }
}

// ---------- Alexa+ simulator (on the MCP page) ----------

function initAlexaSimulator() {
  const alexaForm = document.getElementById("alexa-form");
  const alexaInput = document.getElementById("alexa-input");
  const alexaButton = document.getElementById("alexa-send");
  const alexaOutput = document.getElementById("alexa-output");

  alexaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sentence = alexaInput.value.trim();
    if (!sentence) {
      return;
    }

    alexaButton.disabled = true;
    alexaOutput.innerHTML = `<div class="alexa-card"><span class="alexa-label">You said</span>${escapeHtml(sentence)}</div>
      <div class="alexa-card"><span class="alexa-label">Simulated Alexa+ style reply</span>Thinking...</div>`;

    let replyText;
    try {
      const result = await api.sendChat(sentence);
      replyText = result.reply;
      if (result.tasks_changed) {
        notifyTasksChanged();
      }
    } catch (error) {
      replyText = `Sorry, that did not work. ${error.message}`;
    }

    alexaOutput.innerHTML = `<div class="alexa-card"><span class="alexa-label">You said</span>${escapeHtml(sentence)}</div>
      <div class="alexa-card"><span class="alexa-label">Simulated Alexa+ style reply</span>${escapeHtml(replyText)}</div>`;
    alexaInput.value = "";
    alexaButton.disabled = false;
  });
}

// ---------- setup (called once from app.js) ----------

export function initChat() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  // Enter sends, Shift+Enter makes a new line
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input.value);
    }
  });

  document.getElementById("chat-examples").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (chip) {
      sendMessage(chip.dataset.prompt);
    }
  });

  document.getElementById("chat-clear").addEventListener("click", async () => {
    const confirmed = await confirmDialog("Clear the whole chat history? Your tasks are not deleted.", "Clear chat");
    if (!confirmed) {
      return;
    }
    try {
      await api.clearChatHistory();
      messagesBox.innerHTML = "";
      showWelcome();
      showToast("Chat cleared", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  initAlexaSimulator();
}