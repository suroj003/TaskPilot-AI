// errorHandler.js
// One place to turn errors into JSON. Every API answer looks like this:
//   success: { success: true,  data: ... }
//   failure: { success: false, error: { message, details? } }

const { ZodError } = require("zod");

// use this when we KNOW what went wrong (task not found, bad input, etc.)
class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
  }
}

// Express 4 does not catch errors from async routes by itself, so this wrapper does it
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// for any /api URL that doesn't exist
function apiNotFound(req, res) {
  res.status(404).json({
    success: false,
    error: { message: `There is no API route for ${req.method} ${req.originalUrl}` },
  });
}

// must be the LAST middleware in app.js, Express knows it is an error handler because it has 4 arguments
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // bad input caught by zod
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    const summary = details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join("; ");
    return res.status(400).json({
      success: false,
      error: { message: `Invalid input - ${summary}`, details },
    });
  }

  // errors we threw on purpose
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { message: err.message, details: err.details },
    });
  }

  // express.json() problems
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: { message: "Request body is not valid JSON" } });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, error: { message: "Request body is too big" } });
  }

  // anything else is a real bug, log it for us but don't leak details to the user
  console.error("Unexpected error:", err);
  res.status(500).json({ success: false, error: { message: "Something went wrong on the server" } });
}

module.exports = { AppError, asyncHandler, apiNotFound, errorHandler };