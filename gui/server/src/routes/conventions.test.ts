import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerConventionsRoutes } from "./conventions";

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "gui-conventions-"));
  prevHome = process.env.XDG_CONFIG_HOME;
  // Route the conventions file to a tmpdir by overriding XDG_CONFIG_HOME.
  // The CLI's stateHome() honors XDG_CONFIG_HOME and falls back to ~/.config.
  process.env.XDG_CONFIG_HOME = homeDir;
});
afterEach(() => {
  if (prevHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = prevHome;
  }
  rmSync(homeDir, { recursive: true, force: true });
});

function makeApp(): Hono {
  const app = new Hono();
  registerConventionsRoutes(app);
  return app;
}

describe("conventions routes", () => {
  test("GET /api/conventions returns empty file when missing", async () => {
    const app = makeApp();
    const res = await app.request("/api/conventions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ schemaVersion: 1, platformConventions: {} });
  });

  test("PUT /api/conventions persists then GET reads back", async () => {
    const app = makeApp();
    const put = await app.request("/api/conventions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        platformConventions: {
          kiro: { explicit: ["workspace-steering"] },
        },
      }),
    });
    expect(put.status).toBe(200);

    const get = await app.request("/api/conventions");
    const body = await get.json();
    expect(body.platformConventions.kiro.explicit).toEqual(["workspace-steering"]);
  });

  test("PUT /api/conventions rejects invalid schemaVersion with 400", async () => {
    const app = makeApp();
    const put = await app.request("/api/conventions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 99, platformConventions: {} }),
    });
    expect(put.status).toBe(400);
  });

  test("PUT /api/conventions rejects non-object platformConventions with 400", async () => {
    const app = makeApp();
    const put = await app.request("/api/conventions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, platformConventions: null }),
    });
    expect(put.status).toBe(400);
  });
});
