// env.js
// Reads the .env file and gives the rest of the app one clean config object.
// If something is wrong (bad timezone, bad time format) we stop at startup with a clear message,
// because that is easier than finding a weird bug later.

const path = require("path");
const dotenv = require("dotenv");
const { DateTime } = require("luxon");

// project root = two folders up from src/config
const projectRoot = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

// checks that a value looks like 09:00 or 21:30
function readTime(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${name} must look like HH:mm (for example 09:00) but it is "${value}"`);
  }
  return value;
}

// ----- port -----
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a number between 1 and 65535 but it is "${process.env.PORT}"`);
}

// ----- timezone -----
// luxon marks the zone invalid if the name is not a real IANA zone
const timezone = process.env.APP_TIMEZONE || "Asia/Kolkata";
if (!DateTime.now().setZone(timezone).isValid) {
  throw new Error(`APP_TIMEZONE "${timezone}" is not a valid timezone name (try Asia/Kolkata)`);
}

// ----- workday window used by the planner -----
const workdayStart = readTime("WORKDAY_START", "09:00");
const workdayEnd = readTime("WORKDAY_END", "21:00");
if (workdayEnd <= workdayStart) {
  throw new Error("WORKDAY_END must be later than WORKDAY_START");
}

// ----- gemini key -----
// people sometimes forget to replace the placeholder from .env.example, so treat it as "not set"
let geminiApiKey = (process.env.GEMINI_API_KEY || "").trim();
if (geminiApiKey === "your_gemini_api_key_here") {
  geminiApiKey = "";
}

// ----- database path -----
const rawDatabasePath = process.env.DATABASE_PATH || "./data/taskpilot.db";
const databasePath =
  rawDatabasePath === ":memory:" ? rawDatabasePath : path.resolve(projectRoot, rawDatabasePath);

const config = {
  port,
  nodeEnv: process.env.NODE_ENV || "development",
  timezone,
  databasePath,
  workdayStart,
  workdayEnd,
  geminiApiKey,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiEnabled: geminiApiKey !== "",
  mcpAuthToken: (process.env.MCP_AUTH_TOKEN || "").trim(),
};

// freeze so nobody changes the config by accident while the app runs
module.exports = Object.freeze(config);