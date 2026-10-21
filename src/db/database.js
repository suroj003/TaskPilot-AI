// database.js
// Opens the SQLite database and makes sure the tables exist.
// better-sqlite3 is synchronous, which keeps the service code simple (no callbacks or await).

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config/env");

// make sure the folder (like ./data) exists, otherwise sqlite can't create the file
fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);

// WAL mode is a bit safer and faster when the server reads and writes together
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// create the tables if this is the first run
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

module.exports = db;