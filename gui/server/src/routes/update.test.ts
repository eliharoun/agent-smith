import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerUpdateRoute } from "./update";

type Spawn = (argv: string[]) => Promise<{ stdout: string; exitCode: number }>;

function newApp(spawn: Spawn) {
  const app = new Hono();
  registerUpdateRoute(app, { spawn });
  return app;
}

describe("GET /api/update/preview", () => {
  it("parses 'Already up to date'", async () => {
    const app = newApp(async () => ({
      stdout: "Already up to date with origin/main.\n",
      exitCode: 0,
    }));
    const res = await app.request("/api/update/preview");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      commitsBehind: 0,
      alreadyUpToDate: true,
    });
  });

  it("parses 'would pull N'", async () => {
    const app = newApp(async () => ({
      stdout:
        "smith update would pull 7 commit(s) from origin/main, then run `bun install` and `smith doctor`.\n",
      exitCode: 0,
    }));
    const res = await app.request("/api/update/preview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitsBehind: number;
      alreadyUpToDate: boolean;
    };
    expect(body).toMatchObject({ commitsBehind: 7, alreadyUpToDate: false });
  });

  it("500 on spawn error", async () => {
    const app = newApp(async () => {
      throw new Error("boom");
    });
    const res = await app.request("/api/update/preview");
    expect(res.status).toBe(500);
  });

  it("returns rawOutput verbatim", async () => {
    const app = newApp(async () => ({
      stdout: "Already up to date with origin/main.\n",
      exitCode: 0,
    }));
    const res = await app.request("/api/update/preview");
    const body = (await res.json()) as { rawOutput: string };
    expect(body.rawOutput).toContain("Already up to date");
  });

  it("passes ['update', '--dry-run'] to spawner", async () => {
    let captured: string[] = [];
    const app = newApp(async (argv) => {
      captured = argv;
      return { stdout: "Already up to date\n", exitCode: 0 };
    });
    await app.request("/api/update/preview");
    expect(captured).toEqual(["update", "--dry-run"]);
  });
});
