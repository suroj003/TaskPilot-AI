// ui.js
// Small helpers used by many pages. Keeping them here avoids files importing each other in circles.

// Things the whole app needs to know. app.js fills "today" from the server (so it uses the app timezone).
export const appState = {
  today: null,
};

// IMPORTANT: task titles come from users (and from the AI), so we escape them before putting
// them into innerHTML. Otherwise a title like <img onerror=...> would run code in the page.
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return replacements[character];
  });
}

// ---------- toasts ----------

export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = message; // textContent is safe, no escaping needed
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---------- confirm dialog ----------
// Usage:  if (await confirmDialog("Delete this task?")) { ... }

export function confirmDialog(message, okLabel = "Delete") {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirm-dialog");
    const okButton = document.getElementById("confirm-ok");
    const cancelButton = document.getElementById("confirm-cancel");

    document.getElementById("confirm-message").textContent = message;
    okButton.textContent = okLabel;

    function finish(answer) {
      dialog.close();
      resolve(answer);
    }

    // using onclick/oncancel (not addEventListener) so old handlers are replaced each time
    okButton.onclick = () => finish(true);
    cancelButton.onclick = () => finish(false);
    dialog.oncancel = () => finish(false); // Esc key

    dialog.showModal();
  });
}

// ---------- events ----------

// Whenever tasks change (form saved, AI created something...) we shout this event
// and app.js refreshes the page that is visible.
export function notifyTasksChanged() {
  document.dispatchEvent(new CustomEvent("tasks-changed"));
}

// ---------- formatting ----------

// "16:00" -> "4:00 PM"
export function formatTime(time) {
  if (!time) {
    return "";
  }
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 && hours < 24 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// "2026-10-21" -> "Wed, 21 Oct"
// adding T00:00:00 makes the browser read it as a local date (without it, it may shift by a day)
export function formatDate(dateString) {
  if (!dateString) {
    return "";
  }
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// 90 -> "1 h 30 min"
export function formatDuration(minutes) {
  if (!minutes) {
    return "";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function priorityBadge(priority) {
  return `<span class="badge badge-${escapeHtml(priority)}">${escapeHtml(priority)}</span>`;
}

// the little grey pills under a task title (day, time, duration, deadline)
export function taskMetaHtml(task) {
  const pills = [];

  if (task.scheduled_date) {
    pills.push(`<span class="pill">${escapeHtml(formatDate(task.scheduled_date))}</span>`);
  }
  if (task.start_time) {
    const endText = task.duration_minutes ? "" : "";
    pills.push(`<span class="pill">${escapeHtml(formatTime(task.start_time))}${endText}</span>`);
  }
  if (task.duration_minutes) {
    pills.push(`<span class="pill">${escapeHtml(formatDuration(task.duration_minutes))}</span>`);
  }
  if (task.due_date) {
    const overdue = task.status === "pending" && appState.today && task.due_date < appState.today;
    const label = `${overdue ? "Overdue: " : "Due "}${formatDate(task.due_date)}`;
    pills.push(`<span class="pill ${overdue ? "pill-warning" : ""}">${escapeHtml(label)}</span>`);
  }

  return pills.join("");
}