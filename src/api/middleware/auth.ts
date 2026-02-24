import type { MiddlewareHandler } from "hono";

/**
 * API key middleware.
 *
 * Reads API_KEY from env. If set, every request must include:
 *   X-API-Key: <value>
 *
 * If API_KEY is not set (e.g. local dev without the variable),
 * the middleware is a no-op — all requests pass through.
 */
export function apiKeyAuth(): MiddlewareHandler {
  const apiKey = process.env["API_KEY"];

  if (!apiKey) {
    console.warn("[auth] API_KEY not set — authentication disabled");
    return async (_c, next) => next();
  }

  return async (c, next) => {
    const provided = c.req.header("X-API-Key");

    if (!provided || provided !== apiKey) {
      return c.json({ error: "Unauthorized", message: "Missing or invalid X-API-Key header" }, 401);
    }

    await next();
  };
}
