import { describe, expect, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import * as childProcess from "node:child_process";
import { Hono } from "hono";
import { registerFsShowRoute } from "./fs-show";

function makeApp() {
  const app = new Hono();
  registerFsShowRoute(app);
  return app;
}

describe("POST /api/fs/show", () => {
  test("returns 400 when path query param is missing", async () => {
    const app = makeApp();
    const res = await app.request("/api/fs/show", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("returns 403 when path is outside home directory", async () => {
    const app = makeApp();
    const res = await app.request(
      `/api/fs/show?path=${encodeURIComponent("/etc/passwd")}`,
      { method: "POST" },
    );
    expect(res.status).toBe(403);
  });

  test("returns 403 for path traversal attempt", async () => {
    const app = makeApp();
    const evilPath = join(homedir(), "../../etc/passwd");
    const res = await app.request(
      `/api/fs/show?path=${encodeURIComponent(evilPath)}`,
      { method: "POST" },
    );
    expect(res.status).toBe(403);
  });

  test("returns 200 and spawns for a valid home-relative path", async () => {
    const app = makeApp();
    const safePath = join(homedir(), "Downloads", "foo.smith-bundle.tgz");

    // Stub spawn so we don't actually open a file manager during tests.
    const fakeProc = { unref: () => {} };
    const spy = spyOn(childProcess, "spawn").mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const res = await app.request(
      `/api/fs/show?path=${encodeURIComponent(safePath)}`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
