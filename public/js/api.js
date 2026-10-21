// api.js
// Every request to the backend goes through here, so the other files never touch fetch directly.
// The backend always answers { success: true, data } or { success: false, error: { message } }.

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    throw new Error("Cannot reach the server. Is it still running?");
  }

  // the body might not be JSON if something went really wrong, so be careful
  let payload = null;
  try {
    payload = await response.json();
  } catch (parseError) {
    payload = null;
  }

  if (!response.ok || !payload || payload.success === false) {
    const message = (payload && payload.error && payload.error.message) || `Request failed (status ${response.status})`;
    throw new Error(message);
  }

  return payload.data;
}

// {status: "pending", priority: ""} -> "?status=pending" (empty values are skipped)
function toQueryString(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value).trim());
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const api = {
  // ----- app info -----
  health: () => request("GET", "/api/health"),
  getMcpInfo: () => request("GET", "/api/mcp/info"),

  // ----- tasks -----
  listTasks: (filters = {}) => request("GET", `/api/tasks${toQueryString(filters)}`),
  getStats: () => request("GET", "/api/tasks/stats"),
  createTask: (task) => request("POST", "/api/tasks", task),
  updateTask: (id, changes) => request("PATCH", `/api/tasks/${id}`, changes),
  setTaskCompleted: (id, completed) => request("POST", `/api/tasks/${id}/complete`, { completed }),
  deleteTask: (id) => request("DELETE", `/api/tasks/${id}`),
  loadSampleTasks: () => request("POST", "/api/tasks/sample", {}),

  // ----- planner -----
  getPlan: (date) => request("GET", `/api/planner${toQueryString({ date })}`),
  applySuggestions: (date) => request("POST", "/api/planner/apply", { date }),

  // ----- chat -----
  sendChat: (message) => request("POST", "/api/chat", { message }),
  getChatHistory: () => request("GET", "/api/chat/history"),
  clearChatHistory: () => request("DELETE", "/api/chat/history"),
  getChatStatus: () => request("GET", "/api/chat/status"),
};

// Sends a real MCP "tools/call" message (JSON-RPC) to our /mcp endpoint.
// This is only used by the demo page, it shows that the MCP server really works.
export async function callMcpTool(toolName, args) {
  let response;
  try {
    response = await fetch("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // the MCP spec says clients must accept both kinds of answer
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
  } catch (networkError) {
    throw new Error("Cannot reach the MCP endpoint. Is the server running?");
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (parseError) {
    throw new Error(`MCP endpoint answered with something that is not JSON (status ${response.status})`);
  }
}