import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { runSmith as defaultRunSmith, type SmithRun } from "../services/run-smith";

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export interface ExportsRouteDeps {
  runSmith?: (args: string[]) => Promise<SmithRun>;
}

export function registerExportsRoute(app: Hono, deps: ExportsRouteDeps): void {
  const run = deps.runSmith ?? defaultRunSmith;
  app.post("/api/agents/:name/export/plan", async (c) => {
    const name = c.req.param("name");
    if (!SAFE_NAME.test(name)) {
      return c.json(
        { error: "invalid agent name" },
        400 as ContentfulStatusCode,
      );
    }
    const r = await run(["agent", "export", name, "--dry-run", "--json"]);
    if (r.code !== 0) {
      return c.json(
        { error: r.stderr.split("\n").slice(-5).join("\n") || "dry-run failed" },
        502 as ContentfulStatusCode,
      );
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(r.stdout);
    } catch {
      return c.json(
        { error: "invalid manifest JSON from CLI" },
        502 as ContentfulStatusCode,
      );
    }
    return c.json({ manifest });
  });
}
