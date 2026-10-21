// routes/tasks.js
// REST endpoints for tasks. They are thin on purpose: all real work is in taskService.
//
//   GET    /api/tasks              list (filters: status, priority, date, search)
//   GET    /api/tasks/stats        numbers for the dashboard
//   POST   /api/tasks/sample       add demo tasks
//   GET    /api/tasks/:id          one task
//   POST   /api/tasks              create
//   PATCH  /api/tasks/:id          change fields
//   POST   /api/tasks/:id/complete mark done (body: { "completed": false } reopens it)
//   DELETE /api/tasks/:id          delete

const express = require("express");
const taskService = require("../services/taskService");

const router = express.Router();

// the frontend sends empty filters like ?status=&priority= so throw those away before validating
function removeEmptyValues(query) {
  const cleaned = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value.trim() !== "") {
      cleaned[key] = value.trim();
    }
  }
  return cleaned;
}

router.get("/", (req, res) => {
  const tasks = taskService.listTasks(removeEmptyValues(req.query));
  res.json({ success: true, data: tasks });
});

// these two must come BEFORE "/:id", otherwise Express thinks "stats" is an id
router.get("/stats", (req, res) => {
  res.json({ success: true, data: taskService.getStats() });
});

router.post("/sample", (req, res) => {
  const created = taskService.addSampleTasks();
  res.status(201).json({ success: true, data: created });
});

router.get("/:id", (req, res) => {
  res.json({ success: true, data: taskService.getTaskById(req.params.id) });
});

router.post("/", (req, res) => {
  const task = taskService.createTask(req.body);
  res.status(201).json({ success: true, data: task });
});

router.patch("/:id", (req, res) => {
  const task = taskService.updateTask(req.params.id, req.body);
  res.json({ success: true, data: task });
});

router.post("/:id/complete", (req, res) => {
  // completed defaults to true, send false to reopen the task
  const completed = req.body && req.body.completed === false ? false : true;
  res.json({ success: true, data: taskService.completeTask(req.params.id, completed) });
});

router.delete("/:id", (req, res) => {
  res.json({ success: true, data: taskService.deleteTask(req.params.id) });
});

module.exports = router;