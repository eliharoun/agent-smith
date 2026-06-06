import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export function registerExportsCollisionRoute(app: Hono): void {
  app.post("/api/agents/:name/export/preflight-collision", async (c) => {
    const name = c.req.param("name");
    if (!SAFE_NAME.test(name)) {
      return c.json({ error: "invalid agent name" }, 400 as ContentfulStatusCode);
    }
    const path = c.req.query("path");
    if (!path || path.length === 0) {
      return c.json({ error: "path query param is required" }, 400 as ContentfulStatusCode);
    }
    const target = join(path, name);
    try {
      const st = await stat(target);
      return c.json({ exists: true, modifiedAt: st.mtime.toISOString() });
    } catch {
      return c.json({ exists: false });
    }
  });
}
