// tools.js
// The list of tools that can be used from OUTSIDE the normal UI:
//   - the MCP server (src/mcp/server.js) exposes them to MCP clients
//   - the Gemini chat (src/services/gemini.js) lets the AI call them
// Both end up in taskService / plannerService, so validation is the same everywhere.

const { z } = require("zod");
const { ZodError } = require("zod");
const taskService = require("../services/taskService");
const plannerService = require("../services/plannerService");
const { AppError } = require("../middleware/errorHandler");

// ---------- input rules (zod) used by the MCP SDK ----------

const taskIdShape = {
  task_id: z.number().int().positive().describe("The id of the task"),
};

const dateShape = {
  date: taskService.dateString.optional().describe("Day as YYYY-MM-DD. Leave it out for today."),
};

// ---------- the same fields written as plain JSON schema, Gemini wants this format ----------

const taskProperties = {
  title: { type: "string", description: "Short task title" },
  description: { type: "string", description: "Optional extra details" },
  priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority" },
  due_date: { type: "string", description: "Deadline as YYYY-MM-DD" },
  scheduled_date: { type: "string", description: "Day to work on it, YYYY-MM-DD" },
  start_time: { type: "string", description: "Start time in 24 hour HH:mm, for example 16:00" },
  duration_minutes: { type: "integer", description: "How long it takes in minutes" },
};

const taskIdProperty = { task_id: { type: "integer", description: "The id of the task" } };
const dateProperty = { date: { type: "string", description: "Day as YYYY-MM-DD. Leave out for today." } };

function objectSchema(properties, required = []) {
  return { type: "object", properties, required };
}

// ---------- the tools ----------
// run() gets the arguments and returns plain data. If something is wrong it throws.

const tools = [
  {
    name: "create_task",
    title: "Create task",
    description:
      "Create a new task. Can include priority, a deadline, a day, a start time and a duration. " +
      "A fixed event like 'meeting at 4 PM' should have scheduled_date and start_time.",
    inputShape: taskService.createTaskSchema.shape,
    jsonSchema: objectSchema(taskProperties, ["title"]),
    exampleArgs: { title: "Team meeting", priority: "high", start_time: "16:00", duration_minutes: 60 },
    run: (args) => taskService.createTask(args),
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description: "List tasks. You can filter by status, priority, a day, or search text.",
    inputShape: taskService.listFiltersSchema.shape,
    jsonSchema: objectSchema({
      status: { type: "string", enum: ["pending", "completed", "all"] },
      priority: { type: "string", enum: ["low", "medium", "high"] },
      date: { type: "string", description: "Tasks scheduled or due on this day, YYYY-MM-DD" },
      search: { type: "string", description: "Text to look for in the title or description" },
    }),
    exampleArgs: { status: "pending" },
    run: (args) => taskService.listTasks(args),
  },
  {
    name: "update_task",
    title: "Update or reschedule task",
    description:
      "Change fields of an existing task (title, priority, deadline, day, start time, duration). " +
      "Use this to reschedule a task too. Needs the task id, use list_tasks to find it.",
    inputShape: { ...taskIdShape, ...taskService.updateTaskFieldsSchema.shape },
    jsonSchema: objectSchema({ ...taskIdProperty, ...taskProperties }, ["task_id"]),
    exampleArgs: { task_id: 1, start_time: "11:00" },
    run: ({ task_id, ...changes }) => taskService.updateTask(task_id, changes),
  },
  {
    name: "complete_task",
    title: "Complete task",
    description: "Mark a task as completed.",
    inputShape: taskIdShape,
    jsonSchema: objectSchema(taskIdProperty, ["task_id"]),
    exampleArgs: { task_id: 1 },
    run: ({ task_id }) => taskService.completeTask(task_id, true),
  },
  {
    name: "delete_task",
    title: "Delete task",
    description: "Permanently delete a task. Only do this when the user clearly asked for it.",
    inputShape: taskIdShape,
    jsonSchema: objectSchema(taskIdProperty, ["task_id"]),
    exampleArgs: { task_id: 1 },
    run: ({ task_id }) => taskService.deleteTask(task_id),
  },
  {
    name: "get_daily_plan",
    title: "Get daily plan",
    description:
      "Get the plan for one day: timeline, unscheduled tasks, conflicts, suggestions and free time.",
    inputShape: dateShape,
    jsonSchema: objectSchema(dateProperty),
    exampleArgs: {},
    run: ({ date }) => plannerService.getDailyPlan(date),
  },
  {
    name: "find_conflicts",
    title: "Find schedule conflicts",
    description: "Check one day for pending tasks whose times overlap.",
    inputShape: dateShape,
    jsonSchema: objectSchema(dateProperty),
    exampleArgs: {},
    run: ({ date }) => plannerService.findConflicts(date),
  },
  {
    name: "suggest_schedule",
    title: "Suggest schedule",
    description:
      "Suggest new time slots for tasks that overlap or have no time yet. This only suggests, it changes nothing.",
    inputShape: dateShape,
    jsonSchema: objectSchema(dateProperty),
    exampleArgs: {},
    run: ({ date }) => plannerService.suggestReorganization(date),
  },
  {
    name: "apply_schedule_suggestions",
    title: "Apply schedule suggestions",
    description:
      "Save the suggested time slots from suggest_schedule. This changes tasks, so only use it after the user agrees.",
    inputShape: dateShape,
    jsonSchema: objectSchema(dateProperty),
    exampleArgs: {},
    run: ({ date }) => plannerService.applySuggestions(date),
  },
  {
    name: "get_task_stats",
    title: "Get task statistics",
    description: "Get counts: total, pending, completed, overdue, completion rate and today's progress.",
    inputShape: {},
    jsonSchema: objectSchema({}),
    exampleArgs: {},
    run: () => taskService.getStats(),
  },
];

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

// turns any error into a short message that an AI or a person can understand
function friendlyError(error) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
  }
  if (error instanceof AppError) {
    return error.message;
  }
  console.error("Unexpected tool error:", error);
  return "Something went wrong while running the tool";
}

// runs a tool by name and never throws, so the caller can just check "ok"
function runTool(name, args) {
  const tool = toolsByName.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  try {
    return { ok: true, data: tool.run(args || {}) };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

module.exports = { tools, runTool };