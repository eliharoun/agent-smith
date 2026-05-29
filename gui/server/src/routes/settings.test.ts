import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "settings-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const jm = () => new JobManager({ spawner: () => ({ stop: () => {}, writeStdin: () => {} }) });

describe("settings route", () => {
  it("GET returns defaults on first run", async () => {
    const app = createApp({
      token: "t",
      jobs: jm(),
      guiStatePath: join(root, "gui-state.json"),
      smithVersion: "0.22.0",
    });
    const res = await app.request("/api/settings", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; theme: { intensity: string } };
    expect(body.mode).toBe("guided");
    expect(body.theme.intensity).toBe("medium");
  });

  it("PUT patches and persists", async () => {
    const app = createApp({
      token: "t",
      jobs: jm(),
      guiStatePath: join(root, "gui-state.json"),
      smithVersion: "0.22.0",
    });
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ mode: "expert", theme: { intensity: "high" } }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/settings", { headers: { authorization: "Bearer t" } });
    const body = (await get.json()) as { mode: string; theme: { intensity: string } };
    expect(body.mode).toBe("expert");
    expect(body.theme.intensity).toBe("high");
  });

  it("PUT rejects invalid intensity", async () => {
    const app = createApp({
      token: "t",
      jobs: jm(),
      guiStatePath: join(root, "gui-state.json"),
      smithVersion: "0.22.0",
    });
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ theme: { intensity: "blinding" } }),
    });
    expect(res.status).toBe(400);
  });
});
