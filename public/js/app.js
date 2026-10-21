// app.js
// Entry point of the frontend. It decides which page to show and connects everything.
// Pages are chosen with the URL hash:  #/  (landing)  #/dashboard  #/tasks  #/planner  #/assistant  #/mcp

import { api, callMcpTool } from "./api.js";
import { appState, escapeHtml, showToast, notifyTasksChanged } from "./ui.js";
import { renderDashboard } from "./dashboard.js";
import { initTasks, renderTasks, openTaskDialog } from "./tasks.js";
import { initPlanner, renderPlanner } from "./planner.js";
import { initChat, renderChat } from "./chat.js";

const landing = document.getElementById("landing");
const appShell = document.getElementById("app-shell");
const sidebar = document.getElementById("sidebar");
const pageTitle = document.getElementById("page-title");

// ---------- the MCP page ----------

const mcpTools = []; // filled from /api/mcp/info, used by the tool tester

async function renderMcpPage() {
  try {
    const info = await api.getMcpInfo();

    document.getElementById("mcp-transport").textContent = info.transport;
    document.getElementById("mcp-endpoint").textContent = info.endpoint;
    document.getElementById("mcp-auth-note").textContent = info.auth_required
      ? "This server needs a bearer token. The tool tester below cannot send one, so it will get a 401 answer."
      : "No token is required (MCP_AUTH_TOKEN is empty). Fine for local demos.";

    mcpTools.length = 0;
    mcpTools.push(...info.tools);

    document.getElementById("mcp-tool-list").innerHTML = info.tools
      .map((tool) => `<li class="tool-item"><code>${escapeHtml(tool.name)}</code><br />${escapeHtml(tool.description)}</li>`)
      .join("");

    const select = document.getElementById("mcp-tool-select");
    const previous = select.value;
    select.innerHTML = info.tools
      .map((tool) => `<option value="${escapeHtml(tool.name)}">${escapeHtml(tool.title)} (${escapeHtml(tool.name)})</option>`)
      .join("");
    if (previous) {
      select.value = previous;
    }
    fillExampleArguments();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// puts the example arguments of the chosen tool into the textarea
function fillExampleArguments() {
  const name = document.getElementById("mcp-tool-select").value;
  const tool = mcpTools.find((item) => item.name === name);
  document.getElementById("mcp-args").value = JSON.stringify(tool ? tool.example_args : {}, null, 2);
}

async function runMcpTool() {
  const output = document.getElementById("mcp-output");
  const button = document.getElementById("mcp-run");
  const toolName = document.getElementById("mcp-tool-select").value;

  let args;
  try {
    args = JSON.parse(document.getElementById("mcp-args").value || "{}");
  } catch (error) {
    output.textContent = "The arguments are not valid JSON. Check commas and quotes.";
    return;
  }

  button.disabled = true;
  output.textContent = "Calling the MCP server...";
  try {
    const response = await callMcpTool(toolName, args);
    output.textContent = JSON.stringify(response, null, 2);
    notifyTasksChanged(); // the tool may have changed some tasks
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function initMcpPage() {
  document.getElementById("mcp-tool-select").addEventListener("change", fillExampleArguments);
  document.getElementById("mcp-run").addEventListener("click", runMcpTool);
}

// ---------- pages ----------

const pages = {
  dashboard: { title: "Dashboard", render: renderDashboard },
  tasks: { title: "Tasks", render: renderTasks },
  planner: { title: "Daily planner", render: renderPlanner },
  assistant: { title: "AI assistant", render: renderChat },
  mcp: { title: "Alexa+ and MCP", render: renderMcpPage },
};

let currentPage = null;

function showPage(name) {
  currentPage = name;

  landing.hidden = true;
  appShell.hidden = false;
  sidebar.classList.remove("open"); // closes the menu on phones
  pageTitle.textContent = pages[name].title;

  // show only the chosen view, and highlight its menu link
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === name);
  });

  // the "New task" button doesn't make sense in the chat and MCP pages
  document.getElementById("new-task-button").hidden = name === "assistant" || name === "mcp";

  pages[name].render();
  window.scrollTo(0, 0);
}

function showLanding() {
  currentPage = null;
  appShell.hidden = true;
  landing.hidden = false;
  window.scrollTo(0, 0);
}

// "#/tasks" -> "tasks"
function handleRoute() {
  const name = window.location.hash.replace(/^#\/?/, "");
  if (pages[name]) {
    showPage(name);
  } else {
    showLanding();
  }
}

// ---------- AI status chip in the sidebar ----------

async function loadHealth() {
  const chip = document.getElementById("gemini-status");
  try {
    const health = await api.health();
    appState.today = health.today;
    if (health.gemini_configured) {
      chip.textContent = `AI ready (${health.gemini_model})`;
      chip.classList.add("ok");
    } else {
      chip.textContent = "AI chat off: no Gemini key";
      chip.classList.add("warn");
    }
  } catch (error) {
    chip.textContent = "Server not reachable";
    chip.classList.add("warn");
  }
}

// ---------- start ----------

async function start() {
  initTasks();
  initPlanner();
  initChat();
  initMcpPage();

  document.getElementById("new-task-button").addEventListener("click", () => openTaskDialog());

  document.getElementById("menu-toggle").addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });

  // when tasks change anywhere, redraw the page that is visible.
  // the chat and MCP pages don't list tasks so they don't need it.
  document.addEventListener("tasks-changed", () => {
    if (currentPage && currentPage !== "assistant" && currentPage !== "mcp") {
      pages[currentPage].render();
    }
  });

  window.addEventListener("hashchange", handleRoute);

  await loadHealth(); // we need "today" before drawing the overdue labels
  handleRoute();
}

start();