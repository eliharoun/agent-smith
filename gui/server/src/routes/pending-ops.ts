import type { Hono } from "hono";
import { listPendingOps } from "../../../../src/io/pending-ops";

export interface PendingOpsRouteDeps {
  stateRoot: string;
}

/**
 * GET /api/pending-ops
 *
 * Returns all pending-op records queued for replay. Pending ops are written
 * by the CLI when an agent.install command skips a platform because the CLI
 * wasn't on PATH at the time. Returns { ops: PendingOp[] }; ops is [] when
 * the pending directory is absent or empty.
 */
export function registerPendingOpsRoute(app: Hono, deps: PendingOpsRouteDeps): void {
  app.get("/api/pending-ops", async (c) => {
    const ops = await listPendingOps(deps.stateRoot, {});
    return c.json({ ops });
  });
}
