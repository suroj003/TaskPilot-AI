// plannerService.js
// Builds the daily plan: timeline, conflicts, and suggestions for free slots.
// Times are handled as "minutes since midnight" inside this file (10:30 = 630),
// because comparing numbers is much easier than comparing time strings.

const db = require("../db/database");
const config = require("../config/env");
const { DateTime } = require("luxon");
const { dateString, todayInTimezone, updateTask } = require("./taskService");

// if a task has a start time but no duration we treat it as 1 hour
const DEFAULT_DURATION_MINUTES = 60;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

// ---------- time helpers ----------

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const capped = Math.min(Math.max(totalMinutes, 0), 24 * 60);
  const hours = String(Math.floor(capped / 60)).padStart(2, "0");
  const minutes = String(capped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function durationOf(task) {
  return task.duration_minutes || DEFAULT_DURATION_MINUTES;
}

function startOf(task) {
  return timeToMinutes(task.start_time);
}

function endOf(task) {
  return startOf(task) + durationOf(task);
}

// no date given = today (in the app timezone)
function resolveDate(date) {
  return date ? dateString.parse(date) : todayInTimezone();
}

// small version of a task, used inside conflicts
function brief(task) {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    start_time: task.start_time,
    end_time: minutesToTime(endOf(task)),
  };
}

// high priority first, then earlier deadline, then oldest
function byPriorityThenDue(a, b) {
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1; // no deadline goes last
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.id - b.id;
}

// ---------- getting the tasks of one day ----------

// a task belongs to a day if it is scheduled on it, or it has no schedule but is due that day
function getTasksForDate(date) {
  return db
    .prepare(
      `SELECT * FROM tasks
       WHERE scheduled_date = @date
          OR (scheduled_date IS NULL AND due_date = @date)`
    )
    .all({ date });
}

// ---------- conflicts ----------

// Two tasks overlap when each one starts before the other one ends.
// Only pending tasks with a start time are checked (finished tasks can't conflict).
function detectConflicts(tasks) {
  const scheduled = tasks
    .filter((task) => task.status === "pending" && task.start_time)
    .sort((a, b) => startOf(a) - startOf(b));

  const conflicts = [];

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const first = scheduled[i];
      const second = scheduled[j];

      // list is sorted by start time, so if this one starts after "first" ends,
      // all the later ones do too and we can stop looking
      if (startOf(second) >= endOf(first)) {
        break;
      }

      const overlapMinutes = Math.min(endOf(first), endOf(second)) - startOf(second);
      conflicts.push({
        task_a: brief(first),
        task_b: brief(second),
        overlap_minutes: overlapMinutes,
        message:
          `"${first.title}" (${first.start_time}-${minutesToTime(endOf(first))}) overlaps with ` +
          `"${second.title}" (${second.start_time}-${minutesToTime(endOf(second))}) by ${overlapMinutes} minutes`,
      });
    }
  }

  return conflicts;
}

// ---------- free time and suggestions ----------

// For today we can't suggest a time that already passed, so start from "now" rounded up to 15 min
function earliestStartMinutes(date) {
  const workStart = timeToMinutes(config.workdayStart);
  if (date !== todayInTimezone()) {
    return workStart;
  }
  const now = DateTime.now().setZone(config.timezone);
  const roundedNow = Math.ceil((now.hour * 60 + now.minute) / 15) * 15;
  return Math.max(workStart, roundedNow);
}

// Walk through the busy blocks in order and return the first gap that is big enough.
// Returns the start minute, or null if nothing fits.
function findFreeSlot(busyBlocks, durationNeeded, earliest, latest) {
  const sorted = [...busyBlocks].sort((a, b) => a.start - b.start);
  let cursor = earliest;

  for (const block of sorted) {
    if (block.end <= cursor) {
      continue; // this block is already behind us
    }
    if (block.start - cursor >= durationNeeded) {
      return cursor; // the gap before this block is big enough
    }
    cursor = Math.max(cursor, block.end);
  }

  return latest - cursor >= durationNeeded ? cursor : null;
}

// total busy minutes inside the workday, without counting overlapping parts twice
function countBusyMinutes(blocks, from, to) {
  const clipped = blocks
    .map((block) => ({ start: Math.max(block.start, from), end: Math.min(block.end, to) }))
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = from;
  for (const block of clipped) {
    const start = Math.max(block.start, cursor);
    if (block.end > start) {
      total += block.end - start;
      cursor = block.end;
    }
  }
  return total;
}

// Suggestion rules:
//  1. for every conflict, move the less important task (if same priority, the one that starts later)
//  2. tasks that have no time yet get a slot too
//  3. each suggestion goes into the first free gap, high priority tasks are placed first
function buildSuggestions(date, tasks, conflicts) {
  const pending = tasks.filter((task) => task.status === "pending");
  const tasksById = new Map(pending.map((task) => [task.id, task]));

  const toMove = new Map(); // task id -> why we are moving it
  for (const conflict of conflicts) {
    if (toMove.has(conflict.task_a.id) || toMove.has(conflict.task_b.id)) {
      continue; // one of them is already being moved, so this conflict is probably solved
    }
    const a = tasksById.get(conflict.task_a.id);
    const b = tasksById.get(conflict.task_b.id);
    const moveA = PRIORITY_RANK[a.priority] > PRIORITY_RANK[b.priority];
    const loser = moveA ? a : b;
    const winner = moveA ? b : a;
    toMove.set(loser.id, `Overlaps with "${winner.title}"`);
  }

  // everything that stays where it is blocks time
  const busy = pending
    .filter((task) => task.start_time && !toMove.has(task.id))
    .map((task) => ({ start: startOf(task), end: endOf(task) }));

  const unscheduled = pending.filter((task) => !task.start_time);
  const movingTasks = [...toMove.keys()].map((id) => tasksById.get(id));
  const candidates = [...movingTasks, ...unscheduled].sort(byPriorityThenDue);

  const earliest = earliestStartMinutes(date);
  const latest = timeToMinutes(config.workdayEnd);
  const suggestions = [];

  for (const task of candidates) {
    const duration = durationOf(task);
    const reason = toMove.get(task.id) || "Not placed on the timeline yet";
    const start = findFreeSlot(busy, duration, earliest, latest);

    if (start === null) {
      suggestions.push({
        task_id: task.id,
        title: task.title,
        priority: task.priority,
        duration_minutes: duration,
        reason: `${reason}. No free time is left in the workday, try another day`,
        new_start_time: null,
        new_end_time: null,
      });
      continue;
    }

    busy.push({ start, end: start + duration }); // this slot is taken now
    suggestions.push({
      task_id: task.id,
      title: task.title,
      priority: task.priority,
      duration_minutes: duration,
      reason,
      new_start_time: minutesToTime(start),
      new_end_time: minutesToTime(start + duration),
    });
  }

  return suggestions;
}

// ---------- what the routes and tools call ----------

function getDailyPlan(date) {
  const day = resolveDate(date);
  const tasks = getTasksForDate(day);
  const conflicts = detectConflicts(tasks);

  const conflictIds = new Set();
  for (const conflict of conflicts) {
    conflictIds.add(conflict.task_a.id);
    conflictIds.add(conflict.task_b.id);
  }

  const timeline = tasks
    .filter((task) => task.start_time)
    .sort((a, b) => startOf(a) - startOf(b))
    .map((task) => ({
      ...task,
      end_time: minutesToTime(endOf(task)),
      has_conflict: conflictIds.has(task.id),
    }));

  const unscheduled = tasks.filter((task) => !task.start_time).sort(byPriorityThenDue);

  const workStart = timeToMinutes(config.workdayStart);
  const workEnd = timeToMinutes(config.workdayEnd);
  const pendingBlocks = tasks
    .filter((task) => task.status === "pending" && task.start_time)
    .map((task) => ({ start: startOf(task), end: endOf(task) }));
  const busyMinutes = countBusyMinutes(pendingBlocks, workStart, workEnd);

  const completedCount = tasks.filter((task) => task.status === "completed").length;

  return {
    date: day,
    timezone: config.timezone,
    workday_start: config.workdayStart,
    workday_end: config.workdayEnd,
    timeline,
    unscheduled,
    conflicts,
    suggestions: buildSuggestions(day, tasks, conflicts),
    summary: {
      total: tasks.length,
      completed: completedCount,
      pending: tasks.length - completedCount,
      scheduled_minutes: busyMinutes,
      free_minutes: workEnd - workStart - busyMinutes,
    },
  };
}

function findConflicts(date) {
  const day = resolveDate(date);
  const conflicts = detectConflicts(getTasksForDate(day));
  return { date: day, has_conflicts: conflicts.length > 0, conflicts };
}

function suggestReorganization(date) {
  const day = resolveDate(date);
  const tasks = getTasksForDate(day);
  const conflicts = detectConflicts(tasks);
  return { date: day, conflicts, suggestions: buildSuggestions(day, tasks, conflicts) };
}

// actually saves the suggested times (only for suggestions that found a free slot)
function applySuggestions(date) {
  const { date: day, suggestions } = suggestReorganization(date);
  const applied = [];

  for (const suggestion of suggestions) {
    if (!suggestion.new_start_time) {
      continue;
    }
    updateTask(suggestion.task_id, {
      scheduled_date: day,
      start_time: suggestion.new_start_time,
      duration_minutes: suggestion.duration_minutes,
    });
    applied.push(suggestion);
  }

  const skipped = suggestions.length - applied.length;
  return { date: day, applied, skipped_without_free_slot: skipped };
}

module.exports = {
  getDailyPlan,
  findConflicts,
  suggestReorganization,
  applySuggestions,
};