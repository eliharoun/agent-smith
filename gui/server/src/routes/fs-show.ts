import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Open the parent directory of a file in the OS file manager.
 *  Only paths inside the user's home directory are accepted to prevent
 *  path-traversal abuse from a rogue browser tab. */
export function registerFsShowRoute(app: Hono): void {
  app.post("/api/fs/show", (c) => {
    const raw = c.req.query("path") ?? "";
    if (!raw) {
      return c.json({ error: "path query parameter is required" }, 400 as ContentfulStatusCode);
    }

    const abs = resolve(raw);
    const home = homedir();

    // Reject paths that escape the user's home directory.
    if (!abs.startsWith(home + "/") && abs !== home) {
      return c.json({ error: "path is outside home directory" }, 403 as ContentfulStatusCode);
    }

    // Pick the right command per platform to reveal the file in the OS UI.
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      // -R selects (reveals) the file rather than opening it.
      cmd = "open";
      args = ["-R", abs];
    } else if (process.platform === "win32") {
      cmd = "explorer";
      args = ["/select,", abs];
    } else {
      // Linux: open the parent directory with xdg-open since there's no
      // portable "reveal file" equivalent across desktop environments.
      cmd = "xdg-open";
      args = [dirname(abs)];
    }

    // Fire-and-forget: we don't wait for the file manager to close.
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();

    return c.json({ ok: true });
  });
}
