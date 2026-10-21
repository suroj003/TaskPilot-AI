// server.js
// Entry point. "npm start" runs this file.

const config = require("./config/env");
const db = require("./db/database"); // loading this creates the tables
const { createApp } = require("./app");

const app = createApp();

const server = app.listen(config.port, () => {
  console.log("");
  console.log("TaskPilot AI is running");
  console.log(`  Web app:      http://localhost:${config.port}`);
  console.log(`  MCP endpoint: http://localhost:${config.port}/mcp  (POST, Streamable HTTP)`);
  console.log(`  Timezone:     ${config.timezone}`);
  console.log(`  Database:     ${config.databasePath}`);
  if (config.geminiEnabled) {
    console.log(`  Gemini:       enabled (model ${config.geminiModel})`);
  } else {
    console.log("  Gemini:       NOT configured. Add GEMINI_API_KEY to .env to use the AI chat.");
  }
  console.log("");
});

// most common startup problem: the port is already used by another program
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Close the other program or change PORT in .env`);
  } else {
    console.error("Server error:", error);
  }
  process.exit(1);
});

// close the server and the database properly when we stop the app
function shutDown() {
  console.log("\nShutting down...");
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);