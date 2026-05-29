import type { Platform } from "gui-shared";
import type { Hono } from "hono";
import { computeInstalledStatus } from "../services/installed-status";
import { parseRegistry } from "../services/parse-registry";

export interface InstalledStatusesDeps {
  registryPath: string;
  installPathsFor: (agent: string) => Record<Platform, string>;
}

export function registerInstalledStatusesRoute(app: Hono, deps: InstalledStatusesDeps) {
  app.get("/api/agents/installed-statuses", async (c) => {
    const reg = await parseRegistry(deps.registryPath);
    const allAgents: string[] = [];
    for (const info of Object.values(reg.catalogs)) {
      for (const name of info.agents) allAgents.push(name);
    }
    const entries = await Promise.all(
      allAgents.map(async (name) => {
        const status = await computeInstalledStatus({
          agent: name,
          paths: deps.installPathsFor(name),
        });
        return [name, status] as const;
      }),
    );
    return c.json(Object.fromEntries(entries));
  });
}
