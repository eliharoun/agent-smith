import { readFile } from "node:fs/promises";
import type { DaemonStatus } from "gui-shared";

// Keep in sync with src/cli/commands/daemon.ts heartbeatStaleMs default.
export const HEARTBEAT_STALE_MS = 7_000;

export interface DaemonStatusDeps {
  pidPath: string;
  heartbeatPath: string;
  /** Test seam: defaults to process.kill(pid, 0) probe. */
  isProcessAlive?: (pid: number) => boolean;
  /** Test seam: defaults to Date.now. */
  now?: () => number;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but not ours (still alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Inspect the on-disk daemon pid + heartbeat files and classify into one
 * of the four lifecycle states defined by `DaemonStatus` in gui-shared.
 *
 * Layout (per the GUI/CLI state-root contract):
 *   $XDG_STATE_HOME/agent-smith/daemon.pid
 *   $XDG_STATE_HOME/agent-smith/daemon.heartbeat.json
 * (falls back to ~/.local/state/agent-smith/ when XDG_STATE_HOME is unset)
 *
 * The heartbeat threshold (7s) mirrors the CLI's `heartbeatStaleMs`
 * default — keep these in sync.
 */
export async function readDaemonStatus(deps: DaemonStatusDeps): Promise<DaemonStatus> {
  const isAlive = deps.isProcessAlive ?? defaultIsAlive;
  const now = deps.now ?? (() => Date.now());

  let pid: number | null = null;
  try {
    const raw = await readFile(deps.pidPath, "utf8");
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) pid = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (pid === null) return { state: "not-running" };
  if (!isAlive(pid)) return { state: "stale-pid", pid };

  let heartbeatAgeMs: number | null = null;
  try {
    const raw = await readFile(deps.heartbeatPath, "utf8");
    const obj = JSON.parse(raw) as { lastBeatAt?: number };
    if (typeof obj.lastBeatAt === "number") {
      heartbeatAgeMs = Math.max(0, now() - obj.lastBeatAt);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_MS) {
    return { state: "stuck", pid, heartbeatAgeMs };
  }
  return { state: "running", pid, heartbeatAgeMs };
}
