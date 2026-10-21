// routes/planner.js
// REST endpoints for the daily planner. "date" is optional everywhere (default = today).
//
//   GET  /api/planner?date=YYYY-MM-DD              full plan for the day
//   GET  /api/planner/conflicts?date=YYYY-MM-DD    only the overlaps
//   GET  /api/planner/suggestions?date=YYYY-MM-DD  suggested new slots (changes nothing)
//   POST /api/planner/apply   body: { "date": "YYYY-MM-DD" }   saves the suggested slots

const express = require("express");
const plannerService = require("../services/plannerService");

const router = express.Router();

// the query can contain an empty date (?date=), treat that as "not given"
function readDate(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

router.get("/", (req, res) => {
  res.json({ success: true, data: plannerService.getDailyPlan(readDate(req.query.date)) });
});

router.get("/conflicts", (req, res) => {
  res.json({ success: true, data: plannerService.findConflicts(readDate(req.query.date)) });
});

router.get("/suggestions", (req, res) => {
  res.json({ success: true, data: plannerService.suggestReorganization(readDate(req.query.date)) });
});

router.post("/apply", (req, res) => {
  const date = req.body ? readDate(req.body.date) : undefined;
  res.json({ success: true, data: plannerService.applySuggestions(date) });
});

module.exports = router;