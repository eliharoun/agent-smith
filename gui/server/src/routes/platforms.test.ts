import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerPlatformsRoutes } from "./platforms";

describe("GET /api/platforms/detected", () => {
  it("returns the detected set", async () => {
    const app = new Hono();
    registerPlatformsRoutes(app, {
      detect: async () => new Set(["claude-code", "kiro"]),
    });
    const res = await app.request("/api/platforms/detected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected.sort()).toEqual(["claude-code", "kiro"]);
  });

  it("returns empty when nothing detected", async () => {
    const app = new Hono();
    registerPlatformsRoutes(app, { detect: async () => new Set() });
    const res = await app.request("/api/platforms/detected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toEqual([]);
  });
});
