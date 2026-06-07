import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { stat } from "node:fs/promises";
import { runSmith as defaultRunSmith, type SmithRun } from "../services/run-smith";

export interface DiscoverFromDirDeps {
  runSmith?: (args: string[]) => Promise<SmithRun>;
}

/**
 * Shared handler factory. Both agent and skill discovery use the same
 * filesystem-validation + CLI-run logic; only the URL path suffix and
 * CLI argv differ (the route cannot be unified because both differ).
 */
function makeDiscoverHandler(
  kind: "agent" | "skill",
  run: (args: string[]) => Promise<SmithRun>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: Context<any, any, any>) => {
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
    const argv =
      kind === "agent"
        ? ["agent", "install", "--from", dirPath, "--json"]
        : ["skill", "install", "--from", dirPath, "--json"];
    const r = await run(argv);
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
  };
}

export function registerDiscoverFromDirRoute(app: Hono, deps: DiscoverFromDirDeps = {}): void {
  const run = deps.runSmith ?? defaultRunSmith;
  app.post("/api/agents/discover-from-dir", makeDiscoverHandler("agent", run));
  app.post("/api/skills/discover-from-dir", makeDiscoverHandler("skill", run));
}
