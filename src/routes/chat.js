// routes/chat.js
// REST endpoints for the AI assistant.
//
//   POST   /api/chat           body: { "message": "..." }  -> { reply, actions, tasks_changed }
//   GET    /api/chat/history   saved messages
//   DELETE /api/chat/history   clear them
//   GET    /api/chat/status    is the Gemini key configured?

const express = require("express");
const { z } = require("zod");
const config = require("../config/env");
const { asyncHandler } = require("../middleware/errorHandler");
const { chatWithAssistant, getChatHistory, clearChatHistory } = require("../services/gemini");

const router = express.Router();

const messageSchema = z.object({
  message: z.string().trim().min(1, "Message can't be empty").max(1000, "Message is too long (max 1000 characters)"),
});

// chat is async (we wait for Gemini) so we wrap it with asyncHandler
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { message } = messageSchema.parse(req.body);
    const result = await chatWithAssistant(message);
    res.json({ success: true, data: result });
  })
);

router.get("/history", (req, res) => {
  res.json({ success: true, data: getChatHistory() });
});

router.delete("/history", (req, res) => {
  clearChatHistory();
  res.json({ success: true, data: { cleared: true } });
});

// lets the frontend show a friendly banner when there is no key
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: { gemini_configured: config.geminiEnabled, model: config.geminiModel },
  });
});

module.exports = router;