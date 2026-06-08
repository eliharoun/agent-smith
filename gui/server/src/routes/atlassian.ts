import { AtlassianEnvUpdate } from "../../../shared/src/index";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { buildAffectedSources } from "../services/atlassian-affected-sources";
import {
  type AtlassianEnvDeps,
  readAtlassianEnv,
  writeAtlassianEnv,
} from "../services/atlassian-env";

export interface AtlassianRouteDeps {
  /** Forwarded to the atlassian-env service; defaults match the service. */
  envDeps?: AtlassianEnvDeps;
  /**
   * Required for the /api/atlassian/affected-sources endpoint. Omit to
   * disable that endpoint (the route returns 501 if called without it).
   */
  registryPath?: string;
}

export function registerAtlassianRoute(app: Hono, routeDeps: AtlassianRouteDeps = {}): void {
  const envDeps = routeDeps.envDeps ?? {};
  app.get("/api/atlassian-env", async (c) => {
    return c.json(await readAtlassianEnv(envDeps));
  });
  app.put("/api/atlassian-env", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AtlassianEnvUpdate.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    const status = await readAtlassianEnv(envDeps);
    if (!status.editable) {
      throw new HttpError(
        409,
        "NOT_EDITABLE",
        `credentials resolved from ${status.source}; cannot write`,
      );
    }
    await writeAtlassianEnv(parsed.data, envDeps);
    return c.json(await readAtlassianEnv(envDeps));
  });
  app.get("/api/atlassian/affected-sources", async (c) => {
    if (!routeDeps.registryPath) {
      throw new HttpError(501, "NOT_CONFIGURED", "registryPath not provided to atlassian route");
    }
    const sources = await buildAffectedSources({
      registryPath: routeDeps.registryPath,
    });
    return c.json({ sources });
  });
}
