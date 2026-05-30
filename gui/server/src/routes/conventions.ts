// GUI server endpoint for ~/.config/agent-smith/conventions.json
// (Task 3.7).
//
// Wraps the CLI's load/save helpers (src/io/conventions.ts). Per the
// design's Task 3.7 wiring decision, the GUI writes prefs directly via
// PUT before triggering install — the orchestrator's tier-2 resolution
// path picks up the just-written prefs without any new CLI flag.

import type { Hono } from "hono";
import {
  loadConventions,
  saveConventions,
  type ConventionsFile,
} from "../../../../src/io/conventions";

export function registerConventionsRoutes(app: Hono): void {
  app.get("/api/conventions", async (c) => {
    const file = await loadConventions();
    return c.json(file);
  });

  app.put("/api/conventions", async (c) => {
    const body = (await c.req.json()) as ConventionsFile;
    if (body?.schemaVersion !== 1) {
      return c.json({ error: "unsupported schema version" }, 400);
    }
    if (typeof body.platformConventions !== "object" || body.platformConventions === null) {
      return c.json({ error: "platformConventions must be an object" }, 400);
    }
    await saveConventions(body);
    return c.json({ ok: true });
  });
}
