import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDaemonStatus } from "./daemon-status";

let stateDir: string;
let pidPath: string;
let heartbeatPath: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "ds-"));
  pidPath = join(stateDir, "daemon.pid");
  heartbeatPath = join(stateDir, "daemon.heartbeat.json");
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("readDaemonStatus", () => {
  it("returns not-running when pid file missing", async () => {
    expect(await readDaemonStatus({ pidPath, heartbeatPath })).toEqual({ state: "not-running" });
  });

  it("returns stale-pid when pid present but process dead", async () => {
    await writeFile(pidPath, "999999\n");
    const out = await readDaemonStatus({
      pidPath,
      heartbeatPath,
      isProcessAlive: () => false,
    });
    expect(out).toEqual({ state: "stale-pid", pid: 999999 });
  });

  it("returns running with fresh heartbeat", async () => {
    await writeFile(pidPath, "12345\n");
    const now = Date.now();
    await writeFile(heartbeatPath, JSON.stringify({ lastBeatAt: now - 1000 }));
    const out = await readDaemonStatus({
      pidPath,
      heartbeatPath,
      isProcessAlive: () => true,
      now: () => now,
    });
    expect(out).toMatchObject({ state: "running", pid: 12345, heartbeatAgeMs: 1000 });
  });

  it("returns stuck when heartbeat older than threshold", async () => {
    await writeFile(pidPath, "12345\n");
    const now = Date.now();
    await writeFile(heartbeatPath, JSON.stringify({ lastBeatAt: now - 10000 }));
    const out = await readDaemonStatus({
      pidPath,
      heartbeatPath,
      isProcessAlive: () => true,
      now: () => now,
    });
    expect(out).toMatchObject({ state: "stuck", pid: 12345, heartbeatAgeMs: 10000 });
  });

  it("returns running with null heartbeatAgeMs when heartbeat file missing", async () => {
    await writeFile(pidPath, "12345\n");
    const out = await readDaemonStatus({
      pidPath,
      heartbeatPath,
      isProcessAlive: () => true,
    });
    expect(out).toMatchObject({ state: "running", pid: 12345, heartbeatAgeMs: null });
  });
});
