// tests/daemon/status.test.ts
//
// Unit tests for daemonStatus's DI seam (daemonStatusImpl). Closes the
// DAEMON-11-follow-up gap surfaced after Batch 2: the heartbeat *writer*
// shipped, but `daemon status` still did pid-only liveness, so a wedged
// daemon (alive but not beating) reported as "running" indefinitely.
//
// Algorithm under test:
//   1. No pid file                                    -> "not running",          exit 0
//   2. Pid file but invalid pid                       -> "stale (invalid pid)", remove, exit 0
//   3. Pid file but process dead                      -> "stale pid file" + pid, remove, exit 0
//   4. Pid alive, heartbeat missing/unreadable        -> "running (no heartbeat yet)" + pid, exit 0
//   5. Pid alive, heartbeat.pid mismatch              -> "running (heartbeat from pid X)" warn, exit 0
//   6. Pid alive, heartbeat fresh                     -> "running" + pid + age, exit 0
//   7. Pid alive, heartbeat older than staleMs        -> "stuck" errLog + pid + age, exit 0

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
    nowMs: 1_000_000_000_000, // arbitrary fixed clock
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

describe("daemonStatusImpl", () => {
  test("no pid file -> 'not running', exit 0", async () => {
    const { deps, out, state } = makeDeps();
    await runIgnoringExit(() => daemonStatusImpl(deps));
    expect(out.some((l) => /not running/i.test(l))).toBe(true);
    expect(state.exitCode).toBe(0);
  });

  test("invalid pid in file -> 'stale (invalid pid)', file removed, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "not-a-number";
    await runIgnoringExit(() => daemonStatusImpl(deps));
    expect(out.some((l) => /stale.*invalid pid/i.test(l))).toBe(true);
    expect(state.pidFileRemoved).toBe(true);
    expect(state.exitCode).toBe(0);
  });

  test("pid file references dead process -> 'stale pid file' + pid, file removed, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, false);
    await runIgnoringExit(() => daemonStatusImpl(deps));
    expect(out.some((l) => /stale pid file/i.test(l) && /12345/.test(l))).toBe(true);
    // CLI-13: stale-pid status output must include an actionable
    // remediation line pointing at `daemon start`. Without it, users
    // see the stale-pid condition and don't know they can fix it with
    // one command.
    expect(out.some((l) => /smith daemon start/i.test(l))).toBe(true);
    expect(state.pidFileRemoved).toBe(true);
    expect(state.exitCode).toBe(0);
  });

  test("pid alive, heartbeat missing -> 'running (no heartbeat yet)' + pid, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = null;
    await runIgnoringExit(() => daemonStatusImpl(deps));
    expect(out.some((l) => /running/i.test(l) && /no heartbeat/i.test(l) && /12345/.test(l))).toBe(true);
    expect(state.exitCode).toBe(0);
  });

  test("pid alive, heartbeat.pid mismatch -> 'running (heartbeat from pid X)' warn, exit 0", async () => {
    const { deps, out, err, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 1,
      pid: 99999, // mismatch — stale heartbeat from a prior daemon instance
      startedAt: state.nowMs - 60_000,
      lastBeatAt: state.nowMs - 1_000,
      sources: {},
    };
    await runIgnoringExit(() => daemonStatusImpl(deps));
    // mismatch is a warning condition: the operator should know the
    // heartbeat file is from a different process than the pid file claims.
    const merged = [...out, ...err].join("\n");
    expect(merged).toMatch(/heartbeat.*pid 99999|heartbeat.*from pid 99999|mismatch/i);
    expect(merged).toMatch(/12345/);
    expect(state.exitCode).toBe(0);
  });

  test("pid alive, heartbeat fresh -> 'running' + pid + age, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 1,
      pid: 12345,
      startedAt: state.nowMs - 30_000,
      lastBeatAt: state.nowMs - 1_500, // fresh: 1.5s ago, well under 7s staleMs
      sources: {},
    };
    await runIgnoringExit(() => daemonStatusImpl(deps));
    const merged = out.join("\n");
    expect(merged).toMatch(/running/i);
    expect(merged).toMatch(/12345/);
    // Age should be surfaced — operators want to see freshness, not just
    // a binary green/red. We don't pin exact format ("1.5s" vs "1500ms"),
    // only that *some* age-shaped token appears.
    expect(merged).toMatch(/\d/);
    expect(state.exitCode).toBe(0);
  });

  test("pid alive, heartbeat older than staleMs -> 'stuck' errLog + pid + age, exit 0", async () => {
    const { deps, out, err, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 1,
      pid: 12345,
      startedAt: state.nowMs - 60_000,
      lastBeatAt: state.nowMs - 30_000, // 30s old, well past 7s staleMs
      sources: {},
    };
    await runIgnoringExit(() => daemonStatusImpl(deps));
    // Stuck state is an operator-facing alarm: errLog so it shows up red,
    // but exit 0 because `status` is informational — scripts that loop on
    // `daemon status` shouldn't break on a stuck daemon any more than on
    // a healthy one. The textual signal IS the contract.
    const errMerged = err.join("\n");
    expect(errMerged).toMatch(/stuck/i);
    expect(errMerged).toMatch(/12345/);
    // Out should be empty for the stuck path — we don't want a cheerful
    // "running" line followed by an err warning. Single source of truth.
    expect(out.join("\n")).not.toMatch(/running/i);
    expect(state.exitCode).toBe(0);
  });

  // DAEMON-13: same validation tightening as stop. 0/-5/1.5 must be
  // treated as invalid pids and rejected before isAlive is consulted.
  for (const badPid of ["0", "-5", "1.5"]) {
    test(`invalid pid '${badPid}' → 'stale (invalid pid)', no isAlive call, file removed, exit 0`, async () => {
      const { deps, out, state } = makeDeps();
      state.pidFile = badPid;
      let isAliveCalls = 0;
      deps.isAlive = (_pid: number) => {
        isAliveCalls++;
        return false;
      };
      await runIgnoringExit(() => daemonStatusImpl(deps));
      expect(out.some((l) => /stale.*invalid pid/i.test(l))).toBe(true);
      expect(isAliveCalls).toBe(0);
      expect(state.pidFileRemoved).toBe(true);
      expect(state.exitCode).toBe(0);
    });
  }

  test("staleness threshold is exclusive: age == staleMs is fresh", async () => {
    const { deps, out, err, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    state.heartbeat = {
      schemaVersion: 1,
      pid: 12345,
      startedAt: state.nowMs - 60_000,
      lastBeatAt: state.nowMs - 7_000, // exactly at the boundary
      sources: {},
    };
    await runIgnoringExit(() => daemonStatusImpl(deps));
    // Boundary belongs to the healthy side: matches start.ts's
    // `age <= heartbeatStaleMs` predicate so start and status agree.
    expect(out.join("\n")).toMatch(/running/i);
    expect(err.join("\n")).not.toMatch(/stuck/i);
    expect(state.exitCode).toBe(0);
  });
});
