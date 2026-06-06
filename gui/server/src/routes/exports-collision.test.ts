import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerExportsCollisionRoute } from "./exports-collision";

describe("POST /api/agents/:name/export/preflight-collision", () => {
  test("returns exists: false when the destination doesn't exist", async () => {
    const app = new Hono();
    registerExportsCollisionRoute(app);
    const dir = await mkdtemp(join(tmpdir(), "preflight-"));
    try {
      const res = await app.request(
        `/api/agents/foo/export/preflight-collision?path=${encodeURIComponent(dir)}`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { exists: boolean };
      expect(body.exists).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns exists: true with modifiedAt when the destination exists", async () => {
    const app = new Hono();
    registerExportsCollisionRoute(app);
    const dir = await mkdtemp(join(tmpdir(), "preflight-"));
    try {
      const target = join(dir, "foo");
      await mkdir(target);
      await writeFile(join(target, "stale.txt"), "old");
      const res = await app.request(
        `/api/agents/foo/export/preflight-collision?path=${encodeURIComponent(dir)}`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { exists: boolean; modifiedAt?: string };
      expect(body.exists).toBe(true);
      expect(body.modifiedAt).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns 400 on invalid agent name", async () => {
    const app = new Hono();
    registerExportsCollisionRoute(app);
    const res = await app.request(
      `/api/agents/--help/export/preflight-collision?path=${encodeURIComponent("/tmp")}`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 when path query param is missing", async () => {
    const app = new Hono();
    registerExportsCollisionRoute(app);
    const res = await app.request(
      `/api/agents/foo/export/preflight-collision`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
  });
});
