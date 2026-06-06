import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { stat } from "node:fs/promises";
import { runSmith as defaultRunSmith, type SmithRun } from "../services/run-smith";

export interface DiscoverFromDirDeps {
  runSmith?: (args: string[]) => Promise<SmithRun>;
}

export function registerDiscoverFromDirRoute(app: Hono, deps: DiscoverFromDirDeps = {}): void {
  const run = deps.runSmith ?? defaultRunSmith;
  app.post("/api/agents/discover-from-dir", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    if (!body || typeof body.path !== "string" || body.path.length === 0) {
      return c.json({ error: "path is required" }, 400 as ContentfulStatusCode);
    }
    const dirPath = body.path;
    try {
      const st = await stat(dirPath);
      if (!st.isDirectory()) {
        return c.json({ error: "path is not a directory" }, 400 as ContentfulStatusCode);
      }
    } catch {
      return c.json({ error: "path does not exist" }, 400 as ContentfulStatusCode);
    }
    const r = await run(["agent", "install", "--from", dirPath, "--json"]);
    if (r.code !== 0) {
      return c.json(
        { error: r.stderr.split("\n").slice(-5).join("\n") || "discovery failed" },
        502 as ContentfulStatusCode,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      return c.json({ error: "invalid envelope" }, 502 as ContentfulStatusCode);
    }
    return c.json(parsed as object);
  });
}
