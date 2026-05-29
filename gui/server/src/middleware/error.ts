import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Middleware form: wraps next() in try/catch. Note that Hono's default
// errorHandler in `compose` catches thrown errors before they bubble to this
// middleware's catch block, so this is effectively a no-op unless callers
// pair it with `app.onError(errorHandler)`. Kept for parity with the planned
// API and to allow direct testing.
export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    return errorHandler(err, c);
  }
}

export function errorHandler(err: unknown, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
  }
  const message = err instanceof Error ? err.message : "unknown error";
  return c.json({ error: message, code: "INTERNAL" }, 500);
}
