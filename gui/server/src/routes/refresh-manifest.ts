import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { readRefreshManifestPlatforms } from "../services/refresh-manifest";

export interface RefreshManifestDeps {
  agentSmithHome: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function registerRefreshManifestRoute(app: Hono, deps: RefreshManifestDeps) {
  app.get("/api/agents/:name/refresh-manifest", async (c) => {
    const name = c.req.param("name");
    if (!NAME_PATTERN.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    const platforms = await readRefreshManifestPlatforms(deps.agentSmithHome, name);
    return c.json({ agent: name, platforms });
  });
}
