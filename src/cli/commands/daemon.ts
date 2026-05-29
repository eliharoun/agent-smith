import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import type { HeartbeatSnapshot } from "../../daemon";
import { runtimeStateHome } from "../../io/runtime-state-home";
import { stateHome } from "../../io/state-home";

// Lazy state-path helpers. Each call re-evaluates `runtimeStateHome()` so
// `XDG_STATE_HOME` mutations (tests, operator overrides) are honored
// without caching module-load-time values.
function stateDir(): string {
  return runtimeStateHome();
}
function pidFile(): string {
  return join(runtimeStateHome(), "daemon.pid");
}
function logFile(): string {
  return join(runtimeStateHome(), "daemon.log");
}
function heartbeatFile(): string {
  return join(runtimeStateHome(), "daemon.heartbeat.json");
}

function isAliveDefault(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strictly parse a pid-file's contents into a positive integer pid.
 * Returns NaN for any input that isn't a base-10 integer string > 0.
 *
 * `Number.parseInt("1.5", 10)` silently returns 1, which would let a
 * corrupted pid file ("1.5") pass validation and signal pid 1 (init/
 * launchd) on stop — see DAEMON-13. We require the trimmed input to
 * match `^\d+$` before parsing so non-integer junk is rejected up front.
 * The downstream `Number.isInteger(pid) && pid > 0` check then rejects
 * `0` and any future negative-encoding edge cases.
 */
function parsePidStrict(raw: string | null): number {
  if (raw === null) return NaN;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return NaN;
  const pid = Number.parseInt(trimmed, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : NaN;
}

/**
 * Injectable surface for daemonStart. Every external dependency (process
 * spawn, filesystem, clock, exit) is stubbable so the start algorithm can
 * be exercised under unit tests without any real I/O. Production callers
 * use defaults via `daemonStart()`.
 */
export interface StartDeps {
  log: (line: string) => void;
  errLog: (line: string) => void;
  pidFileExists: () => Promise<boolean>;
  readPidFile: () => Promise<string | null>;
  writePidFile: (pid: number) => Promise<void>;
  removePidFile: () => Promise<void>;
  /** Returns null if the heartbeat file doesn't exist yet or can't be parsed. */
  readHeartbeat: () => Promise<HeartbeatSnapshot | null>;
  isAlive: (pid: number) => boolean;
  /** Spawn the detached daemon child. Returns its pid (or 0 if spawn failed). */
  spawnDaemon: () => number;
  killProcess: (pid: number, signal?: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  exit: (code?: number) => never;
  /** Hard cap on how long we'll wait for the child to write its first heartbeat. */
  startupTimeoutMs: number;
  /** A heartbeat older than this (relative to `now`) is rejected as stale. */
  heartbeatStaleMs: number;
  /** How often the start command polls the heartbeat file during the wait window. */
  pollIntervalMs: number;
}

/**
 * Verify the spawned daemon child reached steady state before declaring
 * success. Without this, `daemon start` was lying to operators — the
 * child could crash inside loadRegistry() milliseconds after spawn and
 * the user would still see a green "Daemon started" line.
 *
 * Algorithm:
 *   1. If pid file exists and that process is alive → "already running", exit 0.
 *   2. Otherwise spawn the child detached, write its pid to pidFile().
 *   3. Poll the heartbeat file every `pollIntervalMs` for up to
 *      `startupTimeoutMs`. A successful read requires:
 *        - heartbeat exists,
 *        - heartbeat.pid matches our spawned child,
 *        - heartbeat.lastBeatAt is no older than `heartbeatStaleMs`.
 *   4. If the child dies during the poll window → kill (no-op, already dead),
 *      remove pid file, exit 1 with "exited during startup".
 *   5. If we time out → SIGTERM the child, remove pid file, exit 1 with
 *      "failed to start".
 *
 * Closes DAEMON-12 (start verification) and DAEMON-15 (no false-positive
 * "started" message).
 */
export async function daemonStartImpl(deps: StartDeps): Promise<void> {
  // Step 1: short-circuit on live existing daemon.
  if (await deps.pidFileExists()) {
    const raw = await deps.readPidFile();
    const existingPid = parsePidStrict(raw);
    if (Number.isInteger(existingPid) && existingPid > 0 && deps.isAlive(existingPid)) {
      deps.log(`${pc.yellow("Daemon already running")} ${existingPid}`);
      deps.exit(0);
      return;
    }
    // Otherwise: stale pid file. Fall through to spawn a fresh one;
    // writePidFile below will overwrite it.
  }

  // Step 2: spawn detached child + record pid.
  const pid = deps.spawnDaemon();
  if (!pid) {
    deps.errLog(pc.red("Cannot determine entry script"));
    deps.exit(1);
    return;
  }
  await deps.writePidFile(pid);

  // Steps 3–5: poll for a fresh, matching heartbeat.
  const startedPolling = deps.now();
  const deadline = startedPolling + deps.startupTimeoutMs;
  while (deps.now() < deadline) {
    // Detect child death first so the operator sees the right error.
    if (!deps.isAlive(pid)) {
      await deps.removePidFile();
      deps.errLog(
        `${pc.red("Daemon exited during startup")} (pid ${pid}); check log at ${logFile()}`,
      );
      deps.exit(1);
      return;
    }
    const hb = await deps.readHeartbeat();
    if (hb && hb.pid === pid) {
      const age = deps.now() - hb.lastBeatAt;
      if (age <= deps.heartbeatStaleMs) {
        deps.log(`${pc.green("Daemon started")} ${pid}`);
        deps.exit(0);
        return;
      }
    }
    await deps.sleep(deps.pollIntervalMs);
  }

  // Step 5: timeout — kill, clean up, error.
  try {
    deps.killProcess(pid, "SIGTERM");
  } catch {
    // already dead, ignore
  }
  await deps.removePidFile();
  deps.errLog(
    `${pc.red("Daemon failed to start")} within ${deps.startupTimeoutMs}ms; check log at ${logFile()}`,
  );
  deps.exit(1);
}

/**
 * Best-effort one-shot migration of pre-rc.5 daemon files from the
 * legacy CONFIG_HOME location to the new STATE_HOME location. Idempotent.
 * Errors are swallowed — if migration fails, the next `daemon start`
 * will simply create fresh state-home files and the legacy ones become
 * vestigial.
 */
export async function migrateLegacyDaemonFiles(): Promise<void> {
  const legacyDir = stateHome();
  const newDir = runtimeStateHome();
  if (legacyDir === newDir) return;
  await mkdir(newDir, { recursive: true });
  for (const name of ["daemon.pid", "daemon.heartbeat.json", "daemon.log"]) {
    const from = join(legacyDir, name);
    const to = join(newDir, name);
    try {
      const fromExists = await Bun.file(from).exists();
      const toExists = await Bun.file(to).exists();
      if (fromExists && !toExists) {
        await rename(from, to);
      }
    } catch {
      // best effort; do not crash daemon start
    }
  }
}

export async function daemonStart(): Promise<number> {
  await migrateLegacyDaemonFiles();
  await mkdir(stateDir(), { recursive: true });

  const deps: StartDeps = {
    log: (line) => console.log(line),
    errLog: (line) => console.error(line),
    pidFileExists: async () => Bun.file(pidFile()).exists(),
    readPidFile: async () => {
      try {
        return await Bun.file(pidFile()).text();
      } catch {
        return null;
      }
    },
    writePidFile: async (pid) => {
      await writeFile(pidFile(), String(pid));
    },
    removePidFile: async () => {
      await rm(pidFile(), { force: true });
    },
    readHeartbeat: async () => {
      try {
        const raw = await readFile(heartbeatFile(), "utf-8");
        return JSON.parse(raw) as HeartbeatSnapshot;
      } catch {
        return null;
      }
    },
    isAlive: isAliveDefault,
    spawnDaemon: () => {
      const entry = process.argv[1];
      if (!entry) return 0;
      const fd = openSync(logFile(), "a");
      const child = spawn(process.execPath, [entry, "daemon", "run"], {
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
      return child.pid ?? 0;
    },
    killProcess: (pid, signal) => {
      process.kill(pid, signal);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    exit: (code) => process.exit(code),
    startupTimeoutMs: 10_000,
    heartbeatStaleMs: 7_000,
    pollIntervalMs: 100,
  };
  await daemonStartImpl(deps);
  return 0;
}

export async function daemonStop(): Promise<number> {
  const deps: StopDeps = {
    log: (line) => console.log(line),
    errLog: (line) => console.error(line),
    pidFileExists: async () => Bun.file(pidFile()).exists(),
    readPidFile: async () => {
      try {
        return await Bun.file(pidFile()).text();
      } catch {
        return null;
      }
    },
    removePidFile: async () => {
      await rm(pidFile(), { force: true });
    },
    isAlive: isAliveDefault,
    killProcess: (pid, signal) => {
      process.kill(pid, signal);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    exit: (code) => process.exit(code),
    gracefulTimeoutMs: 10_000,
    pollIntervalMs: 100,
    sigkillGraceMs: 500,
  };
  await daemonStopImpl(deps);
  return 0;
}

/**
 * Injectable surface for daemonStop. Same DI pattern as StartDeps so the
 * stop algorithm — graceful SIGTERM, poll for exit, SIGKILL on timeout —
 * can be unit tested without spawning real processes.
 */
export interface StopDeps {
  log: (line: string) => void;
  errLog: (line: string) => void;
  pidFileExists: () => Promise<boolean>;
  readPidFile: () => Promise<string | null>;
  removePidFile: () => Promise<void>;
  isAlive: (pid: number) => boolean;
  killProcess: (pid: number, signal?: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  exit: (code?: number) => never;
  /** Hard cap on how long we'll wait for the child to exit cleanly after SIGTERM. */
  gracefulTimeoutMs: number;
  /** How often to re-check `isAlive` while waiting for graceful exit. */
  pollIntervalMs: number;
  /** How long to wait after SIGKILL before forcibly removing the pid file. */
  sigkillGraceMs: number;
}

/**
 * Stop the daemon politely, then forcefully if it doesn't cooperate.
 *
 * Algorithm:
 *   1. No pid file → "not running", exit 0.
 *   2. Pid file exists but process is dead → remove file, "stale pid",
 *      exit 0.
 *   3. SIGTERM the process. Poll `isAlive` every `pollIntervalMs` for
 *      up to `gracefulTimeoutMs`.
 *   4. Process exits within budget → remove pid file, "stopped", exit 0.
 *   5. Process still alive after budget → SIGKILL, wait `sigkillGraceMs`
 *      for the kernel to deliver, remove pid file, errLog "force-killed",
 *      exit 0. (The daemon IS stopped, just violently — exit 0 is
 *      correct from the operator's perspective.)
 *
 * Closes DAEMON-3 (no graceful-exit verification) and DAEMON-13 (no
 * SIGKILL fallback for wedged children).
 */
export async function daemonStopImpl(deps: StopDeps): Promise<void> {
  if (!(await deps.pidFileExists())) {
    deps.log(pc.dim("Daemon not running"));
    deps.exit(0);
    return;
  }
  const raw = await deps.readPidFile();
  const pid = parsePidStrict(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    await deps.removePidFile();
    deps.log(pc.dim("Daemon not running (invalid pid file removed)"));
    deps.exit(0);
    return;
  }
  if (!deps.isAlive(pid)) {
    await deps.removePidFile();
    deps.log(pc.dim("Daemon not running (stale pid file removed)"));
    deps.exit(0);
    return;
  }

  // Graceful: SIGTERM + poll. Kill may throw ESRCH if the process exits
  // between isAlive() and kill() — that's the success path, fall through.
  try {
    deps.killProcess(pid, "SIGTERM");
  } catch {
    // already dead; swallow
  }

  const deadline = deps.now() + deps.gracefulTimeoutMs;
  while (deps.now() < deadline) {
    if (!deps.isAlive(pid)) {
      await deps.removePidFile();
      deps.log(`${pc.green("Daemon stopped")} ${pid}`);
      deps.exit(0);
      return;
    }
    await deps.sleep(deps.pollIntervalMs);
  }

  // Forceful: SIGKILL fallback. Brief wait for the kernel to deliver,
  // then remove pid file regardless. errLog (not log) so the operator
  // sees a yellow/red flag in their terminal — "the daemon was wedged".
  try {
    deps.killProcess(pid, "SIGKILL");
  } catch {
    // race: died between SIGTERM-poll and SIGKILL; swallow
  }
  await deps.sleep(deps.sigkillGraceMs);
  await deps.removePidFile();
  deps.errLog(
    `${pc.yellow("Daemon force-killed")} ${pid} (did not exit within ${deps.gracefulTimeoutMs}ms after SIGTERM)`,
  );
  deps.exit(0);
}

export async function daemonStatus(): Promise<number> {
  const deps: StatusDeps = {
    log: (line) => console.log(line),
    errLog: (line) => console.error(line),
    pidFileExists: async () => Bun.file(pidFile()).exists(),
    readPidFile: async () => {
      try {
        return await Bun.file(pidFile()).text();
      } catch {
        return null;
      }
    },
    removePidFile: async () => {
      await rm(pidFile(), { force: true });
    },
    readHeartbeat: async () => {
      try {
        const raw = await readFile(heartbeatFile(), "utf-8");
        return JSON.parse(raw) as HeartbeatSnapshot;
      } catch {
        return null;
      }
    },
    isAlive: isAliveDefault,
    now: () => Date.now(),
    exit: (code) => process.exit(code),
    // Mirror StartDeps.heartbeatStaleMs default: a heartbeat older than this
    // (relative to `now`) is treated as "stuck", same threshold the start
    // verifier uses to decide a fresh child has reached steady state.
    heartbeatStaleMs: 7_000,
  };
  await daemonStatusImpl(deps);
  return 0;
}

/**
 * Injectable surface for daemonStatus. Same DI pattern as StartDeps and
 * StopDeps so the algorithm — pid liveness + heartbeat freshness check —
 * can be unit tested without any real I/O.
 */
export interface StatusDeps {
  log: (line: string) => void;
  errLog: (line: string) => void;
  pidFileExists: () => Promise<boolean>;
  readPidFile: () => Promise<string | null>;
  removePidFile: () => Promise<void>;
  /** Returns null if the heartbeat file doesn't exist or can't be parsed. */
  readHeartbeat: () => Promise<HeartbeatSnapshot | null>;
  isAlive: (pid: number) => boolean;
  now: () => number;
  exit: (code?: number) => never;
  /**
   * A heartbeat older than this (relative to `now`) is reported as "stuck".
   * Threshold is inclusive on the healthy side: `age <= heartbeatStaleMs`
   * is fresh, matching daemonStartImpl's startup verification predicate so
   * `start` and `status` agree on what "alive" means.
   */
  heartbeatStaleMs: number;
}

function formatAge(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/**
 * Report daemon liveness, augmenting the pid-file check with a freshness
 * check against the heartbeat file. Without the heartbeat read, a wedged
 * daemon (alive but no longer beating — e.g. blocked in a hung git pull,
 * stuck inside a writeFile that never resolves) reported as "running"
 * forever, defeating the heartbeat infrastructure shipped in Batch 2.
 *
 * Algorithm:
 *   1. No pid file                              -> "not running",                exit 0
 *   2. Pid file but invalid pid                 -> "stale (invalid pid)" + clean, exit 0
 *   3. Pid file but process dead                -> "stale pid file" + pid + clean, exit 0
 *   4. Pid alive, heartbeat missing/unreadable  -> "running (no heartbeat yet)", exit 0
 *   5. Pid alive, heartbeat.pid mismatch        -> "running (heartbeat from pid X)" warn, exit 0
 *   6. Pid alive, heartbeat fresh               -> "running" + pid + age,        exit 0
 *   7. Pid alive, heartbeat stale (> staleMs)   -> "stuck" errLog + pid + age,   exit 0
 *
 * Closes the DAEMON-11 follow-up: the heartbeat writer side shipped in
 * Batch 2 (`src/daemon/heartbeat.ts` + writer loop in `src/daemon/index.ts`)
 * but the reader side never landed.
 *
 * Exit code: always 0. `status` is informational; scripts that loop on
 * `daemon status` shouldn't break on a stuck daemon. The textual signal
 * (and the errLog stream for "stuck") IS the operator contract. A future
 * pass could plumb the EXIT_* taxonomy if differentiated codes prove
 * useful.
 */
export async function daemonStatusImpl(deps: StatusDeps): Promise<void> {
  if (!(await deps.pidFileExists())) {
    deps.log(pc.dim("not running"));
    deps.exit(0);
    return;
  }
  const raw = await deps.readPidFile();
  const pid = parsePidStrict(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    await deps.removePidFile();
    deps.log(pc.dim("stale pid file (invalid pid removed)"));
    deps.exit(0);
    return;
  }
  if (!deps.isAlive(pid)) {
    await deps.removePidFile();
    deps.log(`${pc.yellow("stale pid file")} ${pid} (process not alive; removed)`);
    // CLI-13: tell the operator the next move. Without this, `status`
    // reported the stale-pid condition and exited 0 with no actionable
    // cue — users had to know that `daemon start` would clear and
    // restart. Surfacing the suggestion inline keeps `status` purely
    // informational (no auto-restart from a status command).
    deps.log("Run `smith daemon start` to clear stale pid and start fresh.");
    deps.exit(0);
    return;
  }

  // Process is alive. Now consult the heartbeat to distinguish healthy
  // from wedged.
  const hb = await deps.readHeartbeat();
  if (hb === null) {
    deps.log(`${pc.green("running")} ${pid} ${pc.dim("(no heartbeat yet)")}`);
    deps.exit(0);
    return;
  }
  if (hb.pid !== pid) {
    // Stale heartbeat from a prior daemon instance whose pid file was
    // overwritten. Surfaces a real bug — heartbeat removal in shutdown
    // didn't fire, or two daemons raced. Warn but don't escalate.
    deps.errLog(
      `${pc.yellow("running")} ${pid} (heartbeat from pid ${hb.pid} — possible stale heartbeat file)`,
    );
    deps.exit(0);
    return;
  }
  const age = deps.now() - hb.lastBeatAt;
  if (age <= deps.heartbeatStaleMs) {
    // D.3: surface snapshot.status with meaningful color.
    const status = (hb as { status?: string }).status;
    if (status === "installing") {
      deps.log(
        `${pc.green("running")} ${pid} (${pc.yellow("installing...")} heartbeat ${formatAge(age)} ago)`,
      );
    } else if (status === "degraded") {
      deps.log(
        `${pc.green("running")} ${pid} (heartbeat ${formatAge(age)} ago, status=${pc.red("degraded")})`,
      );
    } else {
      deps.log(
        `${pc.green("running")} ${pid} (heartbeat ${formatAge(age)} ago, status=${pc.green("ready")})`,
      );
    }
    deps.exit(0);
    return;
  }
  // Stuck: alive but not beating. Operator should investigate the daemon
  // log and likely `daemon stop && daemon start`.
  deps.errLog(
    `${pc.red("stuck")} ${pid} (heartbeat ${formatAge(age)} ago, threshold ${formatAge(deps.heartbeatStaleMs)})`,
  );
  deps.exit(0);
}
