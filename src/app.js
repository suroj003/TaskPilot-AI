// app.js
// Puts the Express app together. server.js starts it.

const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config/env");
const { apiNotFound, errorHandler } = require("./middleware/errorHandler");
const taskRoutes = require("./routes/tasks");
const plannerRoutes = require("./routes/planner");
const chatRoutes = require("./routes/chat");
const { createMcpRouter } = require("./mcp/server");
const { tools } = require("./mcp/tools");
const { todayInTimezone } = require("./services/taskService");

function createApp() {
  const app = express();

  // The frontend is served by this same server, so it does not need CORS.
  // This only allows localhost origins, for the case where you open the HTML with another dev server.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true); // curl, MCP clients, same-origin requests
        }
        try {
          const hostname = new URL(origin).hostname;
          return callback(null, hostname === "localhost" || hostname === "127.0.0.1");
        } catch (error) {
          return callback(null, false);
        }
      },
    })
  );

  app.use(express.json({ limit: "100kb" }));

  // ----- small info endpoints -----
  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      data: {
        status: "ok",
        today: todayInTimezone(),
        timezone: config.timezone,
        gemini_configured: config.geminiEnabled,
        gemini_model: config.geminiModel,
      },
    });
  });

  // used by the "Alexa+ / MCP" page of the frontend
  app.get("/api/mcp/info", (req, res) => {
    res.json({
      success: true,
      data: {
        endpoint: `${req.protocol}://${req.get("host")}/mcp`,
        transport: "Streamable HTTP (stateless, JSON responses)",
        auth_required: Boolean(config.mcpAuthToken),
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          example_args: tool.exampleArgs,
        })),
      },
    });
  });

  // ----- API routes -----
  app.use("/api/tasks", taskRoutes);
  app.use("/api/planner", plannerRoutes);
  app.use("/api/chat", chatRoutes);

  // ----- MCP endpoint -----
  app.use("/mcp", createMcpRouter());

  // any other /api URL is a 404 in JSON
  app.use("/api", apiNotFound);

  // ----- frontend -----
  app.use(express.static(path.join(__dirname, "..", "public")));

  // error handler must be last
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };