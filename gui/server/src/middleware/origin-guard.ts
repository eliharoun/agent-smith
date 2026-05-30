// gui/server/src/middleware/origin-guard.ts
//
// C4.3.1 (v1-task): CSRF defense for the GUI server. Rejects state-changing
// requests (POST/PUT/PATCH/DELETE) when the browser's Origin header is
// missing or does not match the server's bound origin.
//
// Read-only verbs (GET/HEAD/OPTIONS) are unguarded — they cannot mutate
// server state by design. The job-dispatch surface is entirely POST so
// the practical effect is "no browser context other than the printed URL
// can dispatch jobs."
//
// Closes security-audit HIGH-2.
//
// `allowedOrigin` may be a string OR a thunk; the thunk form lets the
// production caller (startGuiServer) defer reading the actual bound port
// until after Bun.serve() returns (the port=0 ephemeral case).

import type { MiddlewareHandler } from "hono";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function originGuard(opts: { allowedOrigin: string | (() => string) }): MiddlewareHandler {
  return async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method)) {
      return next();
    }
    const allowed =
      typeof opts.allowedOrigin === "function" ? opts.allowedOrigin() : opts.allowedOrigin;
    const origin = c.req.header("origin");
    if (!origin || origin !== allowed) {
      return c.json({ error: "origin not allowed" }, 403);
    }
    return next();
  };
}
