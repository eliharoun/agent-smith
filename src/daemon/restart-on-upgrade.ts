import type { HeartbeatSnapshot } from ".";

export type RestartAction =
  | "none"
  | "opt-out"
  | "too-recent"
  | "restarted"
  | "shutdown-timeout"
  | "spawn-failed";

export interface RestartResult {
  action: RestartAction;
  pid?: number;
}

export interface RestartDeps {
  log: (line: string) => void;
  errLog: (line: string) => void;
  pidFileExists: () => Promise<boolean>;
  readPidFile: () => Promise<string | null>;
  readHeartbeat: () => Promise<HeartbeatSnapshot | null>;
  isAlive: (pid: number) => boolean;
  killProcess: (pid: number, signal?: NodeJS.Signals) => void;
  /** Spawn a fresh `smith daemon start` detached child. Return the new pid (or 0). */
  spawnDetached: () => number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Skip restart if the existing daemon started within this many ms. */
  recencyGuardMs: number;
  /** Hard cap on how long we'll wait for the PID file to disappear. */
  shutdownTimeoutMs: number;
  /** How often we re-check `pidFileExists` while waiting. */
  pollIntervalMs: number;
  /** Honor SMITH_NO_DAEMON_AUTO_RESTART=1. Set by the caller from env. */
  optOut: boolean;
}

function parsePid(raw: string | null): number {
  if (raw === null) return 0;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return 0;
  const n = Number.parseInt(t, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export async function restartDaemonIfStale(deps: RestartDeps): Promise<RestartResult> {
  if (deps.optOut) {
    return { action: "opt-out" };
  }
  if (!(await deps.pidFileExists())) {
    return { action: "none" };
  }
  const pid = parsePid(await deps.readPidFile());
  if (!pid || !deps.isAlive(pid)) {
    return { action: "none" };
  }
  const hb = await deps.readHeartbeat();
  if (hb && deps.now() - hb.startedAt < deps.recencyGuardMs) {
    return { action: "too-recent", pid };
  }
  // SIGTERM and wait.
  try {
    deps.killProcess(pid, "SIGTERM");
  } catch {
    // already dead; race; fall through.
  }
  const deadline = deps.now() + deps.shutdownTimeoutMs;
  while (deps.now() < deadline) {
    if (!(await deps.pidFileExists())) {
      const newPid = deps.spawnDetached();
      if (!newPid) return { action: "spawn-failed", pid };
      deps.log(`smith daemon restarted (was ${pid}, now ${newPid})`);
      return { action: "restarted", pid: newPid };
    }
    await deps.sleep(deps.pollIntervalMs);
  }
  deps.errLog(
    `smith daemon (${pid}) did not exit within ${deps.shutdownTimeoutMs}ms; skipping auto-restart`,
  );
  return { action: "shutdown-timeout", pid };
}
