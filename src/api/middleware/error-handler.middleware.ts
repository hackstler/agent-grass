import type { MiddlewareHandler } from "hono";
import { DomainError } from "../../domain/errors/index.js";
import { logger } from "../../shared/logger.js";

const ERROR_STATUS_MAP: Record<string, number> = {
  NotFoundError: 404,
  ConflictError: 409,
  ValidationError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
};

/** Maps a DomainError to its HTTP status code. */
export function domainErrorToHttpStatus(error: DomainError): number {
  return ERROR_STATUS_MAP[error.constructor.name] ?? 400;
}

/** Extracts the error category from the class name (e.g. "NotFoundError" → "NotFound"). */
function errorCategory(error: DomainError): string {
  return error.constructor.name.replace(/Error$/, "");
}

/**
 * Global error handler middleware.
 * Maps domain errors to appropriate HTTP status codes.
 * Returns { error: "Category", message: "detail" } for backward compatibility.
 * Falls back to 500 for unexpected errors.
 */
export function errorHandler(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof DomainError) {
        const status = (ERROR_STATUS_MAP[error.constructor.name] ?? 400) as
          | 400
          | 401
          | 403
          | 404
          | 409;
        return c.json({ error: errorCategory(error), message: error.message }, status);
      }
      logger.error({ err: error }, "Unexpected error");
      return c.json({ error: "InternalError", message: "Internal server error" }, 500);
    }
  };
}
