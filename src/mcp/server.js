// mcp/server.js
// Self-hosted MCP server using the official MCP SDK and the Streamable HTTP transport.
// It lives inside our normal Express app at  POST /mcp
// "Stateless" mode = every request creates its own tiny MCP server. No sessions to manage.

const crypto = require("crypto");
const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const config = require("../config/env");
const { tools, runTool } = require("./tools");

// MCP uses JSON-RPC, so errors outside the protocol should look like JSON-RPC too
function jsonRpcError(code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

// builds an MCP server and registers all our tools on it
function createMcpServer() {
  const server = new McpServer({ name: "taskpilot-ai", version: "1.0.0" });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (args) => {
        // same function the Gemini chat uses, so the rules are identical
        const result = runTool(tool.name, args);
        if (result.ok) {
          return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
        }
        return { content: [{ type: "text", text: result.error }], isError: true };
      }
    );
  }

  return server;
}

// optional password: only used when MCP_AUTH_TOKEN is set in .env
function requireToken(req, res, next) {
  if (!config.mcpAuthToken) {
    return next();
  }
  const given = Buffer.from(req.headers.authorization || "");
  const wanted = Buffer.from(`Bearer ${config.mcpAuthToken}`);
  // timingSafeEqual needs same-length buffers, so check the length first
  const matches = given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
  if (!matches) {
    return res.status(401).json(jsonRpcError(-32001, "Missing or wrong bearer token"));
  }
  next();
}

// The MCP spec says servers should check the Origin header, so a random website
// can't talk to a server running on your laptop. Non-browser clients send no Origin at all.
function checkOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }
  try {
    if (new URL(origin).host === req.headers.host) {
      return next();
    }
  } catch (error) {
    // invalid Origin value, falls through to the 403 below
  }
  return res.status(403).json(jsonRpcError(-32002, "Origin not allowed"));
}

function methodNotAllowed(req, res) {
  res.status(405).set("Allow", "POST").json(jsonRpcError(-32000, "Method not allowed. Use POST."));
}

function createMcpRouter() {
  const router = express.Router();
  router.use(checkOrigin);
  router.use(requireToken);

  router.post("/", async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // undefined = stateless mode
      enableJsonResponse: true, // answer with plain JSON instead of an event stream
    });

    // clean up when the request is finished
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(-32603, "Internal server error"));
      }
    }
  });

  // stateless servers have no session stream (GET) and nothing to close (DELETE)
  router.get("/", methodNotAllowed);
  router.delete("/", methodNotAllowed);

  return router;
}

module.exports = { createMcpRouter };