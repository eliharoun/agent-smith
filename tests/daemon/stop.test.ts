// tests/daemon/stop.test.ts
//
// Unit tests for daemonStopImpl. The old `daemonStop` sent SIGTERM and
// immediately removed the pid file, then printed "stopped" — even if the
// child was wedged and ignored the signal. The new shape polls for the
// child to actually exit and falls back to SIGKILL after a timeout.
// Closes DAEMON-3, DAEMON-13.

import { describe, expect, test } from "bun:test";
import { daemonStopImpl, type StopDeps } from "../../src/cli/commands/daemon";

function makeDeps(overrides: Partial<StopDeps> = {}): {
  deps: StopDeps;
  out: string[];
  err: string[];
  state: {
    pidFile: string | null;
    aliveMap: Map<number, boolean>;
    signalsSent: { pid: number; signal: string }[];
    exitCode: number | null;
    fakeClockMs: number;
  };
} {
  const out: string[] = [];
  const err: string[] = [];
  const state = {
    pidFile: null as string | null,
    aliveMap: new Map<number, boolean>(),
    signalsSent: [] as { pid: number; signal: string }[],
    exitCode: null as number | null,
    fakeClockMs: 0,
  };

  const baseDeps: StopDeps = {
    log: (line: string) => out.push(line),
    errLog: (line: string) => err.push(line),
    pidFileExists: async () => state.pidFile !== null,
    readPidFile: async () => state.pidFile,
    removePidFile: async () => {
      state.pidFile = null;
    },
    isAlive: (pid: number) => state.aliveMap.get(pid) ?? false,
    killProcess: (pid: number, signal?: string) => {
      state.signalsSent.push({ pid, signal: signal ?? "SIGTERM" });
    },
    sleep: async (ms: number) => {
      state.fakeClockMs += ms;
    },
    now: () => state.fakeClockMs,
    exit: (code?: number): never => {
      state.exitCode = code ?? 0;
      throw new Error(`__exit__:${code ?? 0}`);
    },
    gracefulTimeoutMs: 5_000,
    pollIntervalMs: 100,
    sigkillGraceMs: 500,
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

describe("daemonStop — graceful-then-forceful stop (DAEMON-3, DAEMON-13)", () => {
  test("no pid file → 'not running' + exit 0, no signals sent", async () => {
    const { deps, out, state } = makeDeps();

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    expect(state.signalsSent.length).toBe(0);
    expect(out.join("\n")).toMatch(/not running/i);
  });

  test("stale pid file (process not alive) → cleans up file, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, false);

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    expect(state.signalsSent.length).toBe(0); // didn't bother signaling
    expect(state.pidFile).toBeNull(); // cleaned up
    expect(out.join("\n")).toMatch(/stale|not running/i);
  });

  test("graceful: SIGTERM, child exits, pid file removed, exit 0", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    // After the first signal-and-poll iteration, the child has exited.
    deps.killProcess = (pid, signal) => {
      state.signalsSent.push({ pid, signal: signal ?? "SIGTERM" });
      // SIGTERM lets the child run shutdown; for the test, mark dead
      // immediately so the first poll iteration sees it gone.
      if (signal === "SIGTERM") state.aliveMap.set(pid, false);
    };

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    expect(state.signalsSent.length).toBe(1);
    expect(state.signalsSent[0]!.signal).toBe("SIGTERM");
    expect(state.pidFile).toBeNull();
    expect(out.join("\n")).toMatch(/stopped/i);
  });

  test("wedged child: SIGTERM ignored, falls back to SIGKILL after timeout", async () => {
    const { deps, err, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    deps.killProcess = (pid, signal) => {
      state.signalsSent.push({ pid, signal: signal ?? "SIGTERM" });
      // SIGKILL actually kills.
      if (signal === "SIGKILL") state.aliveMap.set(pid, false);
      // SIGTERM is ignored — child stays alive.
    };

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    const signals = state.signalsSent.map((s) => s.signal);
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGKILL");
    expect(state.pidFile).toBeNull();
    expect(err.join("\n")).toMatch(/force.*killed|SIGKILL/i);
  });

  test("kill-process throws (already-dead race): treats as success", async () => {
    const { deps, out, state } = makeDeps();
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    deps.killProcess = (pid, _signal) => {
      // Race: the process died between isAlive() and kill(). Node's
      // process.kill throws ESRCH in that case. We must not crash.
      state.aliveMap.set(pid, false);
      throw new Error("ESRCH: no such process");
    };

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    expect(state.pidFile).toBeNull();
    expect(out.join("\n")).toMatch(/stopped/i);
  });

  // DAEMON-13: Number.isFinite accepts 0, negatives, and non-integers.
  // None are valid pids; 0 in particular is dangerous because
  // process.kill(0, ...) signals the current process group on Unix.
  // Validation must reject these BEFORE calling isAlive/killProcess.
  for (const badPid of ["0", "-5", "1.5"]) {
    test(`invalid pid '${badPid}' → cleans up file, no isAlive/kill, exit 0`, async () => {
      const { deps, out, state } = makeDeps();
      state.pidFile = badPid;
      let isAliveCalls = 0;
      deps.isAlive = (_pid: number) => {
        isAliveCalls++;
        return false;
      };
      deps.killProcess = (pid: number, signal?: string) => {
        state.signalsSent.push({ pid, signal: signal ?? "SIGTERM" });
      };

      await runIgnoringExit(() => daemonStopImpl(deps));

      expect(state.exitCode).toBe(0);
      expect(isAliveCalls).toBe(0);
      expect(state.signalsSent.length).toBe(0);
      expect(state.pidFile).toBeNull();
      expect(out.join("\n")).toMatch(/invalid pid|not running/i);
    });
  }

  test("polls within graceful budget before SIGKILL escalation", async () => {
    const { deps, state } = makeDeps({ gracefulTimeoutMs: 500 });
    state.pidFile = "12345";
    state.aliveMap.set(12345, true);
    let polls = 0;
    // Child exits after 3 polls (~300ms simulated).
    deps.isAlive = (pid: number) => {
      if (pid !== 12345) return false;
      polls++;
      return polls < 4;
    };
    deps.killProcess = (pid, signal) => {
      state.signalsSent.push({ pid, signal: signal ?? "SIGTERM" });
    };

    await runIgnoringExit(() => daemonStopImpl(deps));

    expect(state.exitCode).toBe(0);
    // SIGTERM was the only signal — never escalated.
    expect(state.signalsSent.map((s) => s.signal)).toEqual(["SIGTERM"]);
    expect(state.pidFile).toBeNull();
  });
});
