/**
 * Centralised error-handling middleware.
 *
 * Handles:
 *  - Malformed JSON (SyntaxError from express.json())
 *  - Zod validation errors
 *  - JWT errors
 *  - Prisma known errors (unique constraint, not found, etc.)
 *  - Generic / unexpected errors
 *
 * Never exposes stack traces or Prisma internals in production.
 */

export const errorHandler = (err, req, res, _next) => {
  // ── Malformed JSON ───────────────────────────────────────────────────────
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Malformed JSON in request body",
    });
  }

  // ── Zod validation error ─────────────────────────────────────────────────
  if (err?.name === "ZodError") {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map(({ path, message }) => ({ path, message })),
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body is too large" });
  }

  // ── JWT errors ───────────────────────────────────────────────────────────
  if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  if (err?.details) {
    return res.status(err.status || 422).json({ success: false, message: err.message, errors: err.details });
  }

  // ── Prisma known request errors ──────────────────────────────────────────
  if (err?.constructor?.name === "PrismaClientKnownRequestError") {
    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A record with that value already exists",
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Resource not found",
      });
    }
    // Generic Prisma error – log but don't expose internals
    console.error("[Prisma error]", err.code, err.message);
    return res.status(500).json({
      success: false,
      message: "Database operation failed",
    });
  }

  // ── Unexpected errors ────────────────────────────────────────────────────
  console.error("[Unhandled error]", err);

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: status >= 500 ? "Internal server error" : err.message,
  });
};
