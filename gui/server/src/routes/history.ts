import type { Hono } from "hono";
import { readJobHistory, readJobOutput } from "../jobs/job-history";
import { searchLogs } from "../services/log-search";

export interface HistoryRouteDeps {
  jsonlPath: string;
  outputDir: string;
}

/**
 * `/api/history/*` routes:
 *  - `GET /api/history?limit&offset`        — paginated JobHistoryEntry[]
 *  - `GET /api/history/:id/output`           — text/plain log content OR 404
 *  - `GET /api/history/search?q&limit`       — JobHistorySearchHit[]
 *
 * Limits are clamped (history: max 500, search: max 100). `q` is required.
 */
export function registerHistoryRoute(app: Hono, deps: HistoryRouteDeps): void {
  app.get("/api/history", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const entries = await readJobHistory({
      jsonlPath: deps.jsonlPath,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    });
    return c.json(entries);
  });

  app.get("/api/history/:id/output", async (c) => {
    const id = c.req.param("id");
    const raw = await readJobOutput(id, { outputDir: deps.outputDir });
    if (raw === null) return c.json({ error: "not-found" }, 404);
    return new Response(raw, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  });

  app.get("/api/history/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.length === 0) {
      return c.json({ error: "missing-query" }, 400);
    }
    const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const hits = await searchLogs(q, {
      outputDir: deps.outputDir,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20,
    });
    return c.json(hits);
  });
}
