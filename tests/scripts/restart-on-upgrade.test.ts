import { describe, expect, test } from "bun:test";
import { restartDaemonIfStale, type RestartDeps } from "../../src/daemon/restart-on-upgrade";

const baseDeps = (): RestartDeps => ({
  log: () => {},
  errLog: () => {},
  pidFileExists: async () => false,
  readPidFile: async () => null,
  readHeartbeat: async () => null,
  isAlive: () => false,
  killProcess: () => {},
  spawnDetached: () => 0,
  sleep: async () => {},
  now: () => 1_000_000,
  recencyGuardMs: 60_000,
  shutdownTimeoutMs: 10_000,
  pollIntervalMs: 100,
  optOut: false,
});

describe("restartDaemonIfStale", () => {
  test("noop when no daemon is running", async () => {
    let spawned = 0;
    const r = await restartDaemonIfStale({
      ...baseDeps(),
      spawnDetached: () => {
        spawned++;
        return 4242;
      },
    });
    expect(r.action).toBe("none");
    expect(spawned).toBe(0);
  });

  test("noop when opt-out env is set", async () => {
    let killed = 0;
    const r = await restartDaemonIfStale({
      ...baseDeps(),
      pidFileExists: async () => true,
      readPidFile: async () => "1234",
      isAlive: () => true,
      readHeartbeat: async () => ({
        schemaVersion: 2,
        pid: 1234,
        startedAt: 0,
        lastBeatAt: 999_990,
        sources: {},
      }),
      killProcess: () => {
        killed++;
      },
      optOut: true,
    });
    expect(r.action).toBe("opt-out");
    expect(killed).toBe(0);
  });

  test("noop when daemon is < recency guard old", async () => {
    let killed = 0;
    const r = await restartDaemonIfStale({
      ...baseDeps(),
      pidFileExists: async () => true,
      readPidFile: async () => "1234",
      isAlive: () => true,
      readHeartbeat: async () => ({
        schemaVersion: 2,
        pid: 1234,
        startedAt: 999_990, // 10ms ago at now=1_000_000
        lastBeatAt: 999_990,
        sources: {},
      }),
      killProcess: () => {
        killed++;
      },
    });
    expect(r.action).toBe("too-recent");
    expect(killed).toBe(0);
  });

  test("happy path: kill daemon, wait for PID file removal, re-spawn", async () => {
    const killState: { value: { pid: number; signal: NodeJS.Signals | undefined } | null } = {
      value: null,
    };
    let pidExists = true;
    let spawnedPid = 0;
    let pollCount = 0;
    const r = await restartDaemonIfStale({
      ...baseDeps(),
      pidFileExists: async () => pidExists,
      readPidFile: async () => "1234",
      isAlive: () => true,
      readHeartbeat: async () => ({
        schemaVersion: 2,
        pid: 1234,
        startedAt: 0, // very old
        lastBeatAt: 999_999,
        sources: {},
      }),
      killProcess: (pid, signal) => {
        killState.value = { pid, signal };
      },
      sleep: async () => {
        // After 3 polls, the daemon "exits" (PID file is removed).
        pollCount++;
        if (pollCount >= 3) pidExists = false;
      },
      spawnDetached: () => {
        spawnedPid = 9999;
        return 9999;
      },
    });
    expect(r.action).toBe("restarted");
    expect(killState.value).toEqual({ pid: 1234, signal: "SIGTERM" });
    expect(spawnedPid).toBe(9999);
  });

  test("gives up gracefully if PID file doesn't disappear within the budget", async () => {
    let nowVal = 1_000_000;
    const r = await restartDaemonIfStale({
      ...baseDeps(),
      pidFileExists: async () => true, // never disappears
      readPidFile: async () => "1234",
      isAlive: () => true,
      readHeartbeat: async () => ({
        schemaVersion: 2,
        pid: 1234,
        startedAt: 0,
        lastBeatAt: 999_999,
        sources: {},
      }),
      killProcess: () => {},
      now: () => nowVal,
      sleep: async (ms) => {
        nowVal += ms;
      },
      shutdownTimeoutMs: 200,
      pollIntervalMs: 50,
    });
    expect(r.action).toBe("shutdown-timeout");
  });
});
