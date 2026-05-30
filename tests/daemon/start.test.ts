// tests/daemon/start.test.ts
//
// Unit tests for daemonStart's DI seam (daemonStartImpl). Verifies the
// CLI's start command verifies the spawned child actually reached steady
// state via the heartbeat file before claiming success — closing the
// DAEMON-12 / DAEMON-15 gap where `daemon start` returned green even when
// the child crashed milliseconds later.

import { describe, expect, test } from "bun:test";
import { daemonStartImpl, type StartDeps } from "../../src/cli/commands/daemon";
import type { HeartbeatSnapshot } from "../../src/daemon";

function makeDeps(overrides: Partial<StartDeps> = {}): {
  deps: StartDeps;
  out: string[];
  err: string[];
  state: {
    pidFile: string | null;
    heartbeat: HeartbeatSnapshot | null;
    spawnedPids: number[];
    killedPids: number[];
    exitCode: number | null;
    aliveMap: Map<number, boolean>;
    fakeClockMs: number;
  };
} {
  const out: string[] = [];
  const err: string[] = [];
  const state = {
    pidFile: null as string | null,
    heartbeat: null as HeartbeatSnapshot | null,
    spawnedPids: [] as number[],
    killedPids: [] as number[],
    exitCode: null as number | null,
    aliveMap: new Map<number, boolean>(),
    fakeClockMs: 0,
  };

  const baseDeps: StartDeps = {
    log: (line: string) => out.push(line),
    errLog: (line: string) => err.push(line),
    pidFileExists: async () => state.pidFile !== null,
    readPidFile: async () => state.pidFile,
    writePidFile: async (pid: number) => {
      state.pidFile = String(pid);
    },
    removePidFile: async () => {
      state.pidFile = null;
    },
    readHeartbeat: async () => state.heartbeat,
    isAlive: (pid: number) => state.aliveMap.get(pid) ?? false,
    spawnDaemon: () => {
      const pid = 99000 + state.spawnedPids.length;
      state.spawnedPids.push(pid);
      state.aliveMap.set(pid, true);
      return pid;
    },
    killProcess: (pid: number, _signal?: string) => {
      state.killedPids.push(pid);
      state.aliveMap.set(pid, false);
    },
    sleep: async (ms: number) => {
      state.fakeClockMs += ms;
    },
    now: () => state.fakeClockMs,
    exit: (code?: number): never => {
      state.exitCode = code ?? 0;
      // Throw a sentinel so the rest of the function doesn't run after exit.
      throw new Error(`__exit__:${code ?? 0}`);
    },
    startupTimeoutMs: 5_000,
    heartbeatStaleMs: 7_000,
    pollIntervalMs: 100,
  };

  return { deps: { ...baseDeps, ...overrides }, out, err, state };
}

async function runIgnoringExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.startsWith("__exit__:")) throw e;
  }
}

describe("daemonStart — heartbeat-verified startup (DAEMON-12, DAEMON-15)", () => {
  test("happy path: heartbeat appears immediately, exits 0 with success message", async () => {
    const { deps, out, err, state } = makeDeps();
    // The first heartbeat read returns a fresh snapshot for the spawned pid.
    let reads = 0;
    deps.readHeartbeat = async () => {
      reads++;
      // Simulate the child writing its initial heartbeat right away.
      const pid = state.spawnedPids[0] ?? 0;
      return {
        schemaVersion: 1,
        pid,
        startedAt: state.fakeClockMs,
        lastBeatAt: state.fakeClockMs,
        sources: {},
      };
    };

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.spawnedPids.length).toBe(1);
    expect(state.pidFile).toBe(String(state.spawnedPids[0]));
    expect(state.killedPids.length).toBe(0);
    expect(state.exitCode).toBe(0);
    expect(out.join("\n")).toMatch(/started/i);
    expect(err.length).toBe(0);
    expect(reads).toBeGreaterThan(0);
  });

  test("polls until heartbeat appears, then succeeds", async () => {
    const { deps, out, state } = makeDeps();
    let reads = 0;
    deps.readHeartbeat = async () => {
      reads++;
      // First three reads: no heartbeat yet. Fourth read: fresh.
      if (reads < 4) return null;
      const pid = state.spawnedPids[0] ?? 0;
      return {
        schemaVersion: 1,
        pid,
        startedAt: state.fakeClockMs,
        lastBeatAt: state.fakeClockMs,
        sources: {},
      };
    };

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.exitCode).toBe(0);
    expect(reads).toBeGreaterThanOrEqual(4);
    expect(out.join("\n")).toMatch(/started/i);
  });

  test("times out if heartbeat never appears: kills child, removes pid file, exits non-zero with stderr", async () => {
    const { deps, err, state } = makeDeps();
    // readHeartbeat always returns null → poll will keep ticking until timeout.
    deps.readHeartbeat = async () => null;

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.exitCode).toBe(1);
    expect(state.killedPids).toContain(state.spawnedPids[0]!);
    expect(state.pidFile).toBeNull(); // removed after timeout
    expect(err.join("\n")).toMatch(/timed out|failed to start/i);
  });

  test("rejects stale heartbeat (lastBeatAt older than heartbeatStaleMs)", async () => {
    const { deps, err, state } = makeDeps({
      heartbeatStaleMs: 7_000,
      startupTimeoutMs: 2_000,
    });
    // Heartbeat exists but is from a previous daemon run (lastBeatAt is
    // 60s in the past). Poll should not accept it.
    deps.readHeartbeat = async () => ({
      schemaVersion: 1,
      pid: 12345, // different pid — definitely stale
      startedAt: -60_000,
      lastBeatAt: -60_000,
      sources: {},
    });

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.exitCode).toBe(1);
    expect(err.join("\n")).toMatch(/timed out|failed to start/i);
  });

  test("rejects heartbeat written by a different pid (not our spawned child)", async () => {
    const { deps, err, state } = makeDeps();
    let reads = 0;
    deps.readHeartbeat = async () => {
      reads++;
      // Always fresh, but always wrong pid.
      return {
        schemaVersion: 1,
        pid: 12345,
        startedAt: state.fakeClockMs,
        lastBeatAt: state.fakeClockMs,
        sources: {},
      };
    };

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.exitCode).toBe(1);
    expect(err.join("\n")).toMatch(/timed out|failed to start/i);
    expect(reads).toBeGreaterThan(0);
  });

  test("detects child dying during startup poll: exits non-zero with helpful message", async () => {
    const { deps, err, state } = makeDeps();
    deps.readHeartbeat = async () => null;
    // After the first poll iteration, mark the child as dead.
    let polls = 0;
    deps.isAlive = (pid: number) => {
      if (state.spawnedPids.includes(pid)) {
        polls++;
        return polls < 2;
      }
      return false;
    };

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.exitCode).toBe(1);
    expect(state.pidFile).toBeNull();
    expect(err.join("\n")).toMatch(/exited during startup|crashed|check.*log/i);
  });

  test("short-circuits if a live daemon is already running", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "55555";
    state.aliveMap.set(55555, true);

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.spawnedPids.length).toBe(0); // never spawned
    expect(state.exitCode).toBe(0);
    expect(out.join("\n")).toMatch(/already running/i);
  });

  test("treats stale pid file (process not alive) as no-daemon and proceeds to spawn", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "55555";
    state.aliveMap.set(55555, false); // stale
    deps.readHeartbeat = async () => {
      const pid = state.spawnedPids[0] ?? 0;
      return {
        schemaVersion: 1,
        pid,
        startedAt: state.fakeClockMs,
        lastBeatAt: state.fakeClockMs,
        sources: {},
      };
    };

    await runIgnoringExit(() => daemonStartImpl(deps));

    expect(state.spawnedPids.length).toBe(1);
    expect(state.exitCode).toBe(0);
    expect(out.join("\n")).toMatch(/started/i);
  });

  // DAEMON-13: pid file containing 0/-5/1.5 must be treated as stale
  // (NOT short-circuit "already running"). Validation must reject the
  // pid BEFORE calling isAlive — process.kill(0, ...) signals the
  // current process group on Unix, so trusting isAlive(0) to return
  // false is wrong.
  for (const badPid of ["0", "-5", "1.5"]) {
    test(`invalid pid '${badPid}' in existing pid file → treated as stale, validation rejects before isAlive, proceeds to spawn`, async () => {
      const { deps, out, state } = makeDeps();
      state.pidFile = badPid;
      let isAliveCallsForBadPid = 0;
      const originalIsAlive = deps.isAlive;
      deps.isAlive = (pid: number) => {
        const parsed = Number.parseInt(badPid, 10);
        if (pid === parsed) isAliveCallsForBadPid++;
        return originalIsAlive(pid);
      };
      deps.readHeartbeat = async () => {
        const pid = state.spawnedPids[0] ?? 0;
        return {
          schemaVersion: 1,
          pid,
          startedAt: state.fakeClockMs,
          lastBeatAt: state.fakeClockMs,
          sources: {},
        };
      };

      await runIgnoringExit(() => daemonStartImpl(deps));

      // Validation rejected the bad pid before isAlive was consulted.
      expect(isAliveCallsForBadPid).toBe(0);
      // And we proceeded to spawn a fresh daemon successfully.
      expect(state.spawnedPids.length).toBe(1);
      expect(state.exitCode).toBe(0);
      expect(out.join("\n")).toMatch(/started/i);
      expect(out.join("\n")).not.toMatch(/already running/i);
    });
  }
});
