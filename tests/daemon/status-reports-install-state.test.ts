// tests/daemon/status-reports-install-state.test.ts
//
// D.3: `smith daemon status` surfaces snapshot.status in output.

import { describe, expect, test } from "bun:test";
import { daemonStatusImpl, type StatusDeps } from "../../src/cli/commands/daemon";
import type { HeartbeatSnapshot } from "../../src/daemon";

function makeDeps(overrides: Partial<StatusDeps> = {}): {
  deps: StatusDeps;
  out: string[];
  err: string[];
  state: {
    pidFile: string | null;
    heartbeat: HeartbeatSnapshot | null;
    aliveMap: Map<number, boolean>;
    exitCode: number | null;
    nowMs: number;
    pidFileRemoved: boolean;
  };
} {
  const out: string[] = [];
  const err: string[] = [];
  const state = {
    pidFile: null as string | null,
    heartbeat: null as HeartbeatSnapshot | null,
    aliveMap: new Map<number, boolean>(),
    exitCode: null as number | null,
    nowMs: 1_000_000_000_000,
    pidFileRemoved: false,
  };

  const baseDeps: StatusDeps = {
    log: (line: string) => out.push(line),
    errLog: (line: string) => err.push(line),
    pidFileExists: async () => state.pidFile !== null,
    readPidFile: async () => state.pidFile,
    removePidFile: async () => {
      state.pidFile = null;
      state.pidFileRemoved = true;
    },
    readHeartbeat: async () => state.heartbeat,
    isAlive: (pid: number) => state.aliveMap.get(pid) ?? false,
    now: () => state.nowMs,
    exit: (code?: number): never => {
      state.exitCode = code ?? 0;
      throw new Error(`__exit__:${code ?? 0}`);
    },
    heartbeatStaleMs: 7_000,
  };

  return { deps: { ...baseDeps, ...overrides }, out, err, state };
}

async function runIgnoringExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__exit__:")) return;
    throw err;
  }
}

describe("daemonStatusImpl reports snapshot.status [D.3]", () => {
  test("reports status=installing", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 2,
      pid: 12345,
      startedAt: state.nowMs - 5_000,
      lastBeatAt: state.nowMs - 1_000,
      status: "installing",
      sources: {},
    } as HeartbeatSnapshot;
    await runIgnoringExit(() => daemonStatusImpl(deps));
    const merged = out.join("\n");
    expect(merged).toMatch(/installing/i);
    expect(merged).toMatch(/12345/);
    expect(state.exitCode).toBe(0);
  });

  test("reports status=ready", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 2,
      pid: 12345,
      startedAt: state.nowMs - 30_000,
      lastBeatAt: state.nowMs - 1_000,
      status: "ready",
      sources: {},
    } as HeartbeatSnapshot;
    await runIgnoringExit(() => daemonStatusImpl(deps));
    const merged = out.join("\n");
    expect(merged).toMatch(/ready/i);
    expect(merged).toMatch(/12345/);
    expect(state.exitCode).toBe(0);
  });

  test("reports status=degraded", async () => {
    const { deps, out, err, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 2,
      pid: 12345,
      startedAt: state.nowMs - 30_000,
      lastBeatAt: state.nowMs - 1_000,
      status: "degraded",
      sources: {},
    } as HeartbeatSnapshot;
    await runIgnoringExit(() => daemonStatusImpl(deps));
    const merged = [...out, ...err].join("\n");
    expect(merged).toMatch(/degraded/i);
    expect(merged).toMatch(/12345/);
    expect(state.exitCode).toBe(0);
  });
});
