// taskService.js
// All the task logic lives here. The REST routes, the Gemini chat and the MCP tools
// all call these same functions, so every task goes through the same validation.

const { z } = require("zod");
const { DateTime } = require("luxon");
const db = require("../db/database");
const config = require("../config/env");
const { AppError } = require("../middleware/errorHandler");

// ---------- small helpers ----------

// "today" must follow the app timezone, not the timezone of the server machine
function todayInTimezone() {
  return DateTime.now().setZone(config.timezone).toISODate();
}

function nowIso() {
  return DateTime.utc().toISO();
}

// ---------- validation rules ----------

const prioritySchema = z.enum(["low", "medium", "high"]);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must look like YYYY-MM-DD")
  .refine((value) => DateTime.fromISO(value).isValid, "That date does not exist");

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like HH:mm (24 hour clock)");

// nullish() = the value can be left out OR be null
const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title can't be empty").max(200).describe("Short task title"),
  description: z.string().trim().max(1000).default("").describe("Optional extra details"),
  priority: prioritySchema.default("medium").describe("low, medium or high"),
  due_date: dateString.nullish().describe("Deadline as YYYY-MM-DD"),
  scheduled_date: dateString.nullish().describe("Day to work on it, YYYY-MM-DD"),
  start_time: timeString.nullish().describe("Start time in 24 hour HH:mm"),
  duration_minutes: z.number().int().min(5).max(1440).nullish().describe("How long it takes, in minutes"),
});

// for updates every field is optional. null clears a field, leaving it out keeps it as it was
const updateTaskFieldsSchema = z.object({
  title: createTaskSchema.shape.title.optional(),
  description: z.string().trim().max(1000).optional().describe("Optional extra details"),
  priority: prioritySchema.optional().describe("low, medium or high"),
  status: z.enum(["pending", "completed"]).optional().describe("pending or completed"),
  due_date: createTaskSchema.shape.due_date,
  scheduled_date: createTaskSchema.shape.scheduled_date,
  start_time: createTaskSchema.shape.start_time,
  duration_minutes: createTaskSchema.shape.duration_minutes,
});

const updateTaskSchema = updateTaskFieldsSchema.refine(
  (changes) => Object.values(changes).some((value) => value !== undefined),
  { message: "Give at least one field to change" }
);

const listFiltersSchema = z.object({
  status: z.enum(["pending", "completed", "all"]).default("all").describe("pending, completed or all"),
  priority: prioritySchema.optional().describe("only tasks with this priority"),
  date: dateString.optional().describe("tasks scheduled or due on this day, YYYY-MM-DD"),
  search: z.string().trim().max(100).optional().describe("text to look for in title or description"),
});

// ---------- prepared SQL ----------
// Values always go in as parameters (@name), never glued into the SQL string.

const insertStatement = db.prepare(`
  INSERT INTO tasks
    (title, description, priority, due_date, scheduled_date, start_time, duration_minutes, created_at, updated_at)
  VALUES
    (@title, @description, @priority, @due_date, @scheduled_date, @start_time, @duration_minutes, @now, @now)
`);

const updateStatement = db.prepare(`
  UPDATE tasks SET
    title = @title,
    description = @description,
    priority = @priority,
    status = @status,
    due_date = @due_date,
    scheduled_date = @scheduled_date,
    start_time = @start_time,
    duration_minutes = @duration_minutes,
    completed_at = @completed_at,
    updated_at = @updated_at
  WHERE id = @id
`);

const UPDATABLE_COLUMNS = [
  "title",
  "description",
  "priority",
  "status",
  "due_date",
  "scheduled_date",
  "start_time",
  "duration_minutes",
];

function parseId(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError("Task id must be a positive whole number", 400);
  }
  return parsed;
}

// ---------- the main functions ----------

function getTaskById(id) {
  const taskId = parseId(id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) {
    throw new AppError(`Task ${taskId} was not found`, 404);
  }
  return task;
}

function createTask(input) {
  const data = createTaskSchema.parse(input);

  // a start time without a day doesn't make sense, so use today
  const scheduledDate = data.start_time && !data.scheduled_date ? todayInTimezone() : data.scheduled_date;

  const result = insertStatement.run({
    title: data.title,
    description: data.description,
    priority: data.priority,
    due_date: data.due_date ?? null,
    scheduled_date: scheduledDate ?? null,
    start_time: data.start_time ?? null,
    duration_minutes: data.duration_minutes ?? null,
    now: nowIso(),
  });

  return getTaskById(result.lastInsertRowid);
}

// "_" and "%" are special in LIKE, so escape them when the user searches for them
function escapeLike(text) {
  return text.replace(/[\\%_]/g, "\\$&");
}

function listTasks(filters = {}) {
  const f = listFiltersSchema.parse(filters);
  const where = [];
  const params = {};

  if (f.status !== "all") {
    where.push("status = @status");
    params.status = f.status;
  }
  if (f.priority) {
    where.push("priority = @priority");
    params.priority = f.priority;
  }
  if (f.date) {
    where.push("(scheduled_date = @date OR due_date = @date)");
    params.date = f.date;
  }
  if (f.search) {
    where.push("(title LIKE @search ESCAPE '\\' OR description LIKE @search ESCAPE '\\')");
    params.search = `%${escapeLike(f.search)}%`;
  }

  // pending first, then by day and time, then high priority first
  const sql = `
    SELECT * FROM tasks
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY
      (status = 'completed'),
      scheduled_date IS NULL, scheduled_date,
      start_time IS NULL, start_time,
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      id
    LIMIT 500
  `;
  return db.prepare(sql).all(params);
}

function updateTask(id, input) {
  const taskId = parseId(id);
  const changes = updateTaskSchema.parse(input);
  const existing = getTaskById(taskId);

  // start from the saved task and only overwrite what the user sent
  const merged = {};
  for (const column of UPDATABLE_COLUMNS) {
    merged[column] = changes[column] !== undefined ? changes[column] : existing[column];
  }

  // a time without a day is not allowed
  if (merged.start_time && !merged.scheduled_date) {
    if (changes.scheduled_date === null) {
      merged.start_time = null; // they removed the day, so the time goes too
    } else {
      merged.scheduled_date = todayInTimezone();
    }
  }

  updateStatement.run({
    id: taskId,
    ...merged,
    completed_at: merged.status === "completed" ? existing.completed_at || nowIso() : null,
    updated_at: nowIso(),
  });

  return getTaskById(taskId);
}

function completeTask(id, completed = true) {
  return updateTask(id, { status: completed ? "completed" : "pending" });
}

function deleteTask(id) {
  const task = getTaskById(id);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  return task; // send back what was deleted so the UI can say its name
}

// ---------- statistics for the dashboard ----------

function percent(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function getStats() {
  const today = todayInTimezone();

  const overall = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(status = 'completed') AS completed,
              SUM(status = 'pending') AS pending
       FROM tasks`
    )
    .get();

  const byPriorityRows = db
    .prepare("SELECT priority, COUNT(*) AS count FROM tasks WHERE status = 'pending' GROUP BY priority")
    .all();
  const byPriority = { high: 0, medium: 0, low: 0 };
  for (const row of byPriorityRows) {
    byPriority[row.priority] = row.count;
  }

  const overdue = db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < @today")
    .get({ today }).count;

  const todayRow = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed
       FROM tasks
       WHERE scheduled_date = @today OR (scheduled_date IS NULL AND due_date = @today)`
    )
    .get({ today });

  const total = overall.total || 0;
  const completed = overall.completed || 0;
  const todayTotal = todayRow.total || 0;
  const todayCompleted = todayRow.completed || 0;

  return {
    total,
    pending: overall.pending || 0,
    completed,
    completion_rate: percent(completed, total),
    overdue,
    high_priority_pending: byPriority.high,
    by_priority: byPriority,
    today: {
      date: today,
      total: todayTotal,
      completed: todayCompleted,
      pending: todayTotal - todayCompleted,
      completion_rate: percent(todayCompleted, todayTotal),
    },
  };
}

// ---------- demo data ----------

// A few tasks for demos. The gym session overlaps with the team meeting on purpose,
// so the conflict detection has something to show.
function addSampleTasks() {
  const today = todayInTimezone();
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate();

  const samples = [
    { title: "Finish DSA assignment", priority: "high", due_date: today, scheduled_date: today, start_time: "10:00", duration_minutes: 120 },
    { title: "Practice coding", priority: "medium", scheduled_date: today, start_time: "14:00", duration_minutes: 120 },
    { title: "Team meeting", priority: "high", scheduled_date: today, start_time: "16:00", duration_minutes: 60 },
    { title: "Gym session", priority: "low", scheduled_date: today, start_time: "16:30", duration_minutes: 60 },
    { title: "Revise AI course notes", priority: "medium", scheduled_date: today, duration_minutes: 45 },
    { title: "Write hackathon demo script", priority: "high", due_date: tomorrow, scheduled_date: tomorrow, start_time: "11:00", duration_minutes: 90 },
  ];

  const findByTitle = db.prepare("SELECT id FROM tasks WHERE title = ?");

  const insertAll = db.transaction(() => {
    const created = [];
    for (const sample of samples) {
      if (!findByTitle.get(sample.title)) {
        created.push(createTask(sample));
      }
    }
    return created;
  });

  return insertAll();
}

module.exports = {
  // functions
  todayInTimezone,
  getTaskById,
  createTask,
  listTasks,
  updateTask,
  completeTask,
  deleteTask,
  getStats,
  addSampleTasks,
  // validation rules (the MCP tools reuse these)
  dateString,
  timeString,
  prioritySchema,
  createTaskSchema,
  updateTaskFieldsSchema,
  listFiltersSchema,
};