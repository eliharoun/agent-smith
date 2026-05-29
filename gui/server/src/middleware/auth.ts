import type { Context, Next } from "hono";
import { HttpError } from "./error";

export function authMiddleware(expectedToken: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("authorization");
    const queryToken = c.req.query("token");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const provided = bearer ?? queryToken ?? null;
    // NOTE: SMITH_GUI_DEV_TOKEN is honored by the CLI entry point
    // (src/cli/commands/gui.ts), which substitutes the env value as the
    // expectedToken passed here. Do NOT re-honor it in the middleware:
    // doing so would silently accept the env token in any other code
    // path that calls createApp() with a freshly generated token, turning
    // an accidental env-leak into an auth bypass.
    if (provided !== expectedToken) {
      throw new HttpError(401, "UNAUTHORIZED", "invalid or missing token");
    }
    await next();
  };
}
