import type { Hono } from "hono";
import { detectInstalledPlatforms, type PlatformId } from "../../../../src/io/platform-detect";

export interface PlatformsRouteDeps {
  /** Test override. Production calls detectInstalledPlatforms(). */
  detect?: () => Promise<Set<PlatformId>>;
}

/**
 * GET /api/platforms/detected
 *
 * Returns the set of AI coding platform CLIs currently on PATH. Used by
 * the GUI's consent banner so it grants only for platforms the user
 * actually has installed.
 */
export function registerPlatformsRoutes(app: Hono, deps: PlatformsRouteDeps = {}) {
  const detect = deps.detect ?? detectInstalledPlatforms;
  app.get("/api/platforms/detected", async (c) => {
    const set = await detect();
    return c.json({ detected: [...set].sort() });
  });
}
