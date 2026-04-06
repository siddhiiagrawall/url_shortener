// ─── Global Error Handler ─────────────────────────────────────────────────────
//
// WHY A GLOBAL ERROR HANDLER?
//   Instead of handling errors in every controller (try/catch everywhere),
//   we throw errors anywhere and this single middleware catches them all.
//   This enforces a CONSISTENT error response format across the entire API.
//
// HOW EXPRESS ERROR HANDLING WORKS:
//   A middleware with 4 parameters (err, req, res, next) is an error handler.
//   Calling next(err) or throwing inside async middleware routes to this handler.
//   Must be the LAST middleware registered in app.js.
// ─────────────────────────────────────────────────────────────────────────────

function errorHandler(err, req, res, next) {
  // Determine HTTP status code
  // We set err.statusCode in our services when we throw known errors.
  // Default to 500 for unexpected errors (bugs, DB failures, etc.)
  const statusCode = err.statusCode || 500;

  // Determine error code for programmatic handling on the frontend
  const code = err.code || 'INTERNAL_ERROR';

  // The message: show the real message for known errors, generic for unknown
  const message = err.statusCode
    ? err.message
    : 'An unexpected error occurred. Please try again.';

  // Log the full error internally (never send stack traces to clients!)
  if (statusCode >= 500) {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message },
  });
}

module.exports = errorHandler;
