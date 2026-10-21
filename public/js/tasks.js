// tasks.js
// The Tasks page: filters, list of task cards, and the create/edit dialog.

import { api } from "./api.js";
import {
  escapeHtml,
  priorityBadge,
  taskMetaHtml,
  showToast,
  confirmDialog,
  notifyTasksChanged,
} from "./ui.js";

const listBox = document.getElementById("task-list");
const countText = document.getElementById("task-count");

const filterSearch = document.getElementById("filter-search");
const filterStatus = document.getElementById("filter-status");
const filterPriority = document.getElementById("filter-priority");
const filterDate = document.getElementById("filter-date");

const dialog = document.getElementById("task-dialog");
const form = document.getElementById("task-form");
const formError = document.getElementById("task-form-error");
const fields = {
  id: document.getElementById("task-id"),
  title: document.getElementById("task-title"),
  description: document.getElementById("task-description"),
  priority: document.getElementById("task-priority"),
  dueDate: document.getElementById("task-due-date"),
  scheduledDate: document.getElementById("task-scheduled-date"),
  startTime: document.getElementById("task-start-time"),
  duration: document.getElementById("task-duration"),
};

// we keep the loaded tasks here so edit buttons can find the task by id without asking the server again
let loadedTasks = [];

// ---------- list ----------

function currentFilters() {
  return {
    search: filterSearch.value,
    status: filterStatus.value,
    priority: filterPriority.value,
    date: filterDate.value,
  };
}

function hasActiveFilters() {
  return Object.values(currentFilters()).some((value) => value.trim() !== "");
}

function taskCardHtml(task) {
  const done = task.status === "completed";
  const description = task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : "";

  return `
    <article class="task-card ${done ? "is-done" : ""}" data-id="${task.id}">
      <input class="task-check" type="checkbox" ${done ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} as done" />
      <div class="task-body">
        <p class="task-title">${escapeHtml(task.title)}</p>
        ${description}
        <div class="task-meta">${taskMetaHtml(task)}</div>
      </div>
      <div class="task-actions">
        ${priorityBadge(task.priority)}
        <button class="icon-button" type="button" data-action="edit" aria-label="Edit ${escapeHtml(task.title)}">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="icon-button" type="button" data-action="delete" aria-label="Delete ${escapeHtml(task.title)}">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </article>`;
}

export async function renderTasks() {
  try {
    loadedTasks = await api.listTasks(currentFilters());
  } catch (error) {
    listBox.innerHTML = `<p class="form-error">Could not load tasks: ${escapeHtml(error.message)}</p>`;
    countText.textContent = "";
    return;
  }

  countText.textContent = `${loadedTasks.length} task${loadedTasks.length === 1 ? "" : "s"}`;

  if (loadedTasks.length === 0) {
    listBox.innerHTML = hasActiveFilters()
      ? `<div class="empty-state"><h3>No tasks match your filters</h3><p>Try clearing the filters.</p></div>`
      : `<div class="empty-state"><h3>No tasks yet</h3><p>Use "New task" at the top, or ask the AI assistant.</p></div>`;
    return;
  }

  listBox.innerHTML = loadedTasks.map(taskCardHtml).join("");
}

// ---------- create / edit dialog ----------

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

// task = undefined means "new task"
export function openTaskDialog(task) {
  form.reset();
  formError.hidden = true;

  document.getElementById("task-dialog-title").textContent = task ? "Edit task" : "New task";

  if (task) {
    fields.id.value = task.id;
    fields.title.value = task.title;
    fields.description.value = task.description || "";
    fields.priority.value = task.priority;
    fields.dueDate.value = task.due_date || "";
    fields.scheduledDate.value = task.scheduled_date || "";
    fields.startTime.value = task.start_time || "";
    fields.duration.value = task.duration_minutes || "";
  } else {
    fields.id.value = "";
  }

  dialog.showModal();
  fields.title.focus();
}

// empty inputs are sent as null, which means "no value" (and clears the field when editing)
function readForm() {
  return {
    title: fields.title.value.trim(),
    description: fields.description.value.trim(),
    priority: fields.priority.value,
    due_date: fields.dueDate.value || null,
    scheduled_date: fields.scheduledDate.value || null,
    start_time: fields.startTime.value || null,
    duration_minutes: fields.duration.value ? Number(fields.duration.value) : null,
  };
}

async function saveTask(event) {
  event.preventDefault();
  formError.hidden = true;

  const data = readForm();
  if (!data.title) {
    showFormError("Please give the task a title.");
    return;
  }

  const taskId = fields.id.value;
  try {
    if (taskId) {
      await api.updateTask(taskId, data);
      showToast("Task updated", "success");
    } else {
      await api.createTask(data);
      showToast("Task created", "success");
    }
    dialog.close();
    notifyTasksChanged();
  } catch (error) {
    showFormError(error.message); // for example "duration_minutes: Number must be greater than or equal to 5"
  }
}

// ---------- clicks inside the list ----------

async function handleListClick(event) {
  const card = event.target.closest(".task-card");
  if (!card) {
    return;
  }
  const task = loadedTasks.find((item) => item.id === Number(card.dataset.id));
  if (!task) {
    return;
  }

  // the checkbox
  if (event.target.classList.contains("task-check")) {
    const checkbox = event.target;
    try {
      await api.setTaskCompleted(task.id, checkbox.checked);
      showToast(checkbox.checked ? "Nice, task completed" : "Task reopened", "success");
      notifyTasksChanged();
    } catch (error) {
      checkbox.checked = !checkbox.checked; // put the box back as it was
      showToast(error.message, "error");
    }
    return;
  }

  // the edit and delete buttons
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "edit") {
    openTaskDialog(task);
  }

  if (button.dataset.action === "delete") {
    const confirmed = await confirmDialog(`Delete "${task.title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      await api.deleteTask(task.id);
      showToast("Task deleted", "success");
      notifyTasksChanged();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
}

// ---------- setup (called once from app.js) ----------

export function initTasks() {
  listBox.addEventListener("click", handleListClick);
  form.addEventListener("submit", saveTask);
  document.getElementById("task-cancel").addEventListener("click", () => dialog.close());

  // search runs while typing, but wait a bit so we don't call the server for every key
  let searchTimer = null;
  filterSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTasks, 250);
  });
  [filterStatus, filterPriority, filterDate].forEach((element) => element.addEventListener("change", renderTasks));

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("task-filters").reset();
    renderTasks();
  });

  // the filter form should never reload the page
  document.getElementById("task-filters").addEventListener("submit", (event) => event.preventDefault());
}