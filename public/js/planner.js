// planner.js
// The Daily planner page. The server does all the planning work (plannerService),
// this file only shows the result and lets the user move between days.

import { api } from "./api.js";
import {
  escapeHtml,
  formatTime,
  formatDuration,
  priorityBadge,
  showToast,
  notifyTasksChanged,
} from "./ui.js";

const dateInput = document.getElementById("planner-date");
const summaryBox = document.getElementById("planner-summary");
const timelineBox = document.getElementById("planner-timeline");
const conflictsBox = document.getElementById("planner-conflicts");
const suggestionsBox = document.getElementById("planner-suggestions");
const unscheduledBox = document.getElementById("planner-unscheduled");
const applyButton = document.getElementById("apply-suggestions");

// the day we are showing. Empty at first = let the server pick "today" in the app timezone
let currentDate = "";

// "2026-10-21" + 1 -> "2026-10-22"
// we use local date parts (not toISOString) because toISOString converts to UTC and can shift the day
function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + amount);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function summaryCard(label, value, subText) {
  return `
    <div class="stat-card">
      <p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value">${escapeHtml(value)}</p>
      <p class="stat-sub">${escapeHtml(subText)}</p>
    </div>`;
}

function renderSummary(plan) {
  const s = plan.summary;
  summaryBox.innerHTML = [
    summaryCard("Tasks", `${s.completed} / ${s.total}`, `${s.pending} still to do`),
    summaryCard("Booked", formatDuration(s.scheduled_minutes) || "0 min", `between ${formatTime(plan.workday_start)} and ${formatTime(plan.workday_end)}`),
    summaryCard("Free", formatDuration(Math.max(s.free_minutes, 0)) || "0 min", "left in the workday"),
  ].join("");
}

function renderTimeline(plan) {
  if (plan.timeline.length === 0) {
    timelineBox.innerHTML = `<div class="empty-state"><h3>Nothing on the timeline</h3><p>Tasks with a start time appear here.</p></div>`;
    return;
  }

  timelineBox.innerHTML = plan.timeline
    .map((task) => {
      const classes = ["timeline-item", `priority-${task.priority}`];
      if (task.has_conflict) classes.push("has-conflict");
      if (task.status === "completed") classes.push("is-done");

      const conflictPill = task.has_conflict ? `<span class="pill pill-warning">Conflict</span>` : "";
      const donePill = task.status === "completed" ? `<span class="pill">Done</span>` : "";

      return `
        <div class="${classes.join(" ")}">
          <div class="timeline-time">${escapeHtml(formatTime(task.start_time))}<br />to ${escapeHtml(formatTime(task.end_time))}</div>
          <div class="timeline-card">
            <p class="timeline-title">${escapeHtml(task.title)}</p>
            <div class="timeline-sub">
              ${priorityBadge(task.priority)}
              <span class="pill">${escapeHtml(formatDuration(task.duration_minutes) || "1 h (assumed)")}</span>
              ${conflictPill}${donePill}
            </div>
          </div>
        </div>`;
    })
    .join("");
}

function renderConflicts(plan) {
  if (plan.conflicts.length === 0) {
    conflictsBox.innerHTML = `<p class="muted">No overlapping tasks on this day.</p>`;
    return;
  }

  conflictsBox.innerHTML = plan.conflicts
    .map((conflict) => `
      <div class="alert-item">
        <strong>${escapeHtml(conflict.overlap_minutes)} min overlap</strong>
        ${escapeHtml(conflict.message)}
      </div>`)
    .join("");
}

function renderSuggestions(plan) {
  const suggestions = plan.suggestions;
  const canApply = suggestions.some((suggestion) => suggestion.new_start_time);
  applyButton.hidden = !canApply;

  if (suggestions.length === 0) {
    suggestionsBox.innerHTML = `<p class="muted">Nothing to reorganize. This day looks good.</p>`;
    return;
  }

  suggestionsBox.innerHTML = suggestions
    .map((suggestion) => {
      const slot = suggestion.new_start_time
        ? `Move to ${formatTime(suggestion.new_start_time)} - ${formatTime(suggestion.new_end_time)}`
        : "No free slot today";
      return `
        <div class="suggestion-item">
          <strong>${escapeHtml(suggestion.title)}</strong>
          ${escapeHtml(slot)}<br />
          <span>${escapeHtml(suggestion.reason)}</span>
        </div>`;
    })
    .join("");
}

function renderUnscheduled(plan) {
  if (plan.unscheduled.length === 0) {
    unscheduledBox.innerHTML = `<p class="muted">Every task for this day has a time.</p>`;
    return;
  }

  unscheduledBox.innerHTML = plan.unscheduled
    .map((task) => `
      <div class="list-row ${task.status === "completed" ? "is-done" : ""}">
        <span class="list-row-main">${escapeHtml(task.title)}</span>
        ${priorityBadge(task.priority)}
      </div>`)
    .join("");
}

export async function renderPlanner() {
  try {
    const plan = await api.getPlan(currentDate);
    currentDate = plan.date; // now we know which day the server used
    dateInput.value = plan.date;

    renderSummary(plan);
    renderTimeline(plan);
    renderConflicts(plan);
    renderSuggestions(plan);
    renderUnscheduled(plan);
  } catch (error) {
    timelineBox.innerHTML = `<p class="form-error">Could not load the plan: ${escapeHtml(error.message)}</p>`;
    showToast(error.message, "error");
  }
}

async function applySuggestions() {
  applyButton.disabled = true;
  try {
    const result = await api.applySuggestions(currentDate);
    const skipped = result.skipped_without_free_slot;
    let message = `Rescheduled ${result.applied.length} task(s)`;
    if (skipped > 0) {
      message += `, ${skipped} had no free slot`;
    }
    showToast(message, "success");
    notifyTasksChanged();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    applyButton.disabled = false;
  }
}

export function initPlanner() {
  dateInput.addEventListener("change", () => {
    if (dateInput.value) {
      currentDate = dateInput.value;
      renderPlanner();
    }
  });

  document.getElementById("planner-prev").addEventListener("click", () => {
    if (currentDate) {
      currentDate = addDays(currentDate, -1);
      renderPlanner();
    }
  });

  document.getElementById("planner-next").addEventListener("click", () => {
    if (currentDate) {
      currentDate = addDays(currentDate, 1);
      renderPlanner();
    }
  });

  document.getElementById("planner-today").addEventListener("click", () => {
    currentDate = ""; // empty means "today" for the server
    renderPlanner();
  });

  applyButton.addEventListener("click", applySuggestions);
}