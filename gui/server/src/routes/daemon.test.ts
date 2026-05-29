import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerDaemonRoute } from "./daemon";

let stateDir: string;
let envPath: string;
let logPath: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "dr-"));
  envPath = join(stateDir, ".env");
  logPath = join(stateDir, "daemon.log");
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function newApp() {
  const app = new Hono();
  registerDaemonRoute(app, {
    daemonPidPath: join(stateDir, "daemon.pid"),
    daemonHeartbeatPath: join(stateDir, "daemon.heartbeat.json"),
    daemonLogPath: logPath,
    smithEnvPath: envPath,
    isProcessAlive: () => false,
  });
  return app;
}

describe("GET /api/daemon/status", () => {
  it("returns not-running when pid missing", async () => {
    const app = newApp();
    const res = await app.request("/api/daemon/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "not-running" });
  });
});

describe("GET /api/daemon/env", () => {
  it("returns {} when env file missing", async () => {
    const app = newApp();
    const res = await app.request("/api/daemon/env");
    expect(await res.json()).toEqual({});
  });

  it("returns parsed values", async () => {
    await writeFile(envPath, "SMITH_PULL_INTERVAL_MS=60000\n");
    const app = newApp();
    const res = await app.request("/api/daemon/env");
    expect(await res.json()).toEqual({ pullIntervalMs: 60000 });
  });
});

describe("PUT /api/daemon/env", () => {
  it("writes valid values and echoes back the result", async () => {
    const app = newApp();
    const res = await app.request("/api/daemon/env", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pullIntervalMs: 60000, heartbeatIntervalMs: 3000 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pullIntervalMs: 60000,
      heartbeatIntervalMs: 3000,
    });
  });

  it("rejects negative integers with 400", async () => {
    const app = newApp();
    const res = await app.request("/api/daemon/env", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pullIntervalMs: -1 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/daemon/log/stream", () => {
  it("returns SSE content-type and emits initial lines", async () => {
    await writeFile(logPath, "line1\nline2\n");
    const app = newApp();
    const res = await app.request("/api/daemon/log/stream", {
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Read SSE frames until both initial lines have been emitted (each
    // line is its own frame). Bail after a hard cap so the test can't hang.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (let i = 0; i < 5 && !(text.includes("line1") && text.includes("line2")); i++) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    await reader.cancel();
    expect(text).toContain("line1");
    expect(text).toContain("line2");
  });
});
