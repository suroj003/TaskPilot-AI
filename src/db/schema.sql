-- schema.sql
-- Runs every time the server starts. IF NOT EXISTS means it won't wipe existing data.

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),

  -- dates are stored as plain text "YYYY-MM-DD", times as "HH:mm" (24 hour)
  due_date TEXT,            -- the deadline
  scheduled_date TEXT,      -- the day we plan to work on it
  start_time TEXT,          -- when it starts that day (empty = not placed on the timeline yet)
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- indexes make the filters and the planner queries faster
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_date ON tasks (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);

-- remembers the chat so the assistant has some context after a page refresh
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);