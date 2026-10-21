// dashboard.js
// Draws the dashboard: stat cards, today's tasks and the priority bars.

import { api } from "./api.js";
import {
  escapeHtml,
  formatTime,
  priorityBadge,
  showToast,
  notifyTasksChanged,
} from "./ui.js";

const statsBox = document.getElementById("dashboard-stats");
const todayBox = document.getElementById("dashboard-today");
const prioritiesBox = document.getElementById("dashboard-priorities");

function statCard(label, value, subText, progressPercent = null) {
  const progress =
    progressPercent === null
      ? ""
      : `<div class="progress" role="progressbar" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100">
           <div class="progress-fill" style="width: ${progressPercent}%"></div>
         </div>`;

  return `
    <div class="stat-card">
      <p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value">${escapeHtml(value)}</p>
      ${progress}
      <p class="stat-sub">${escapeHtml(subText)}</p>
    </div>`;
}

function renderStats(stats) {
  const today = stats.today;
  statsBox.innerHTML = [
    statCard("Today's tasks", `${today.completed} / ${today.total}`, today.total === 0 ? "Nothing planned for today" : `${today.pending} still to do`, today.completion_rate),
    statCard("Overall progress", `${stats.completion_rate}%`, `${stats.completed} of ${stats.total} tasks completed`, stats.completion_rate),
    statCard("High priority", String(stats.high_priority_pending), "pending high priority tasks"),
    statCard("Overdue", String(stats.overdue), stats.overdue === 0 ? "You are on track" : "past their deadline"),
  ].join("");
}

function renderToday(tasks) {
  if (tasks.length === 0) {
    todayBox.innerHTML = `<p class="muted">Nothing is scheduled or due today.</p>`;
    return;
  }

  todayBox.innerHTML = tasks
    .map((task) => {
      const time = task.start_time ? formatTime(task.start_time) : "Any time";
      return `
        <div class="list-row ${task.status === "completed" ? "is-done" : ""}">
          <span class="list-row-time">${escapeHtml(time)}</span>
          <span class="list-row-main">${escapeHtml(task.title)}</span>
          ${priorityBadge(task.priority)}
        </div>`;
    })
    .join("");
}

function renderPriorities(stats) {
  const counts = stats.by_priority;
  const biggest = Math.max(counts.high, counts.medium, counts.low, 1); // at least 1 so we never divide by 0

  prioritiesBox.innerHTML = ["high", "medium", "low"]
    .map((level) => {
      const width = Math.round((counts[level] / biggest) * 100);
      return `
        <div class="bar-row">
          <span style="text-transform: capitalize">${level}</span>
          <div class="bar-track"><div class="bar-fill bar-${level}" style="width: ${width}%"></div></div>
          <span>${counts[level]}</span>
        </div>`;
    })
    .join("");
}

// shown instead of everything when the database has no tasks at all
function renderEmptyState() {
  statsBox.innerHTML = `
    <div class="panel" style="grid-column: 1 / -1">
      <div class="empty-state">
        <h3>No tasks yet</h3>
        <p>Create one with the "New task" button, tell the AI assistant what you need to do, or load a few demo tasks.</p>
        <button id="load-sample-button" class="button button-primary" type="button">Load sample tasks</button>
      </div>
    </div>`;
  todayBox.innerHTML = `<p class="muted">Nothing here yet.</p>`;
  prioritiesBox.innerHTML = `<p class="muted">Nothing here yet.</p>`;

  document.getElementById("load-sample-button").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try {
      const created = await api.loadSampleTasks();
      showToast(`Added ${created.length} sample tasks`, "success");
      notifyTasksChanged();
    } catch (error) {
      showToast(error.message, "error");
      event.target.disabled = false;
    }
  });
}

export async function renderDashboard() {
  try {
    const stats = await api.getStats();

    if (stats.total === 0) {
      renderEmptyState();
      return;
    }

    const todayTasks = await api.listTasks({ date: stats.today.date });
    renderStats(stats);
    renderToday(todayTasks);
    renderPriorities(stats);
  } catch (error) {
    statsBox.innerHTML = `<p class="form-error">Could not load the dashboard: ${escapeHtml(error.message)}</p>`;
  }
}