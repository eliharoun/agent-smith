import type { Hono } from "hono";
import { isLocalSmithClone } from "../../../../src/core/protected-bundles";
import { parseRegistry } from "../services/parse-registry";

export interface StatusDeps {
  registryPath: string;
  smithVersion?: string;
}

export function registerStatusRoute(app: Hono, deps: StatusDeps) {
  // rc.3: /api/status no longer reports daemonRunning. The TopBar and
  // StatStrip consume /api/daemon/status directly so the four-state
  // daemon classification (running / stuck / stale-pid / not-running)
  // is the single source of truth across the GUI.
  const smithVersion = deps.smithVersion ?? "unknown";
  app.get("/api/status", async (c) => {
    const reg = await parseRegistry(deps.registryPath);
    let agentCount = 0;
    for (const info of Object.values(reg.catalogs)) agentCount += info.agents.length;
    return c.json({
      agentCount,
      smithVersion,
      // True when the GUI server runs from a maintainer's clone — drives the
      // client's clone-mode banner. End-users (npm-installed) get false.
      cloneMode: isLocalSmithClone(),
    });
  });
}
