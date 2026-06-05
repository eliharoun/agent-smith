import pc from "picocolors";
import { refreshOneSource as defaultRefreshOneSource } from "../cli/commands/knowledge/refresh-session-fetch";
import { defaultCacheRoot as defaultRefreshCacheRoot } from "../cli/commands/knowledge/refresh-session-runner";
import {
  defaultAgentSmithHome as defaultAgentSmithHomeImpl,
  defaultInstallPaths,
} from "../cli/install-paths";
import {
  loadAllBundles as defaultLoadAllBundles,
  type LoadAllBundlesResult,
  warnAllLoadFailures,
} from "../cli/load-all";
import { buildRefreshHooksMap } from "../core/knowledge/refresh-hooks-map";
import { parseRefresh } from "../core/knowledge/refresh-spec";
import type { AgentBundle, InstallPaths } from "../core/types";
import { pullIfClean as defaultPullIfClean, type PullResult } from "../io/git";
import {
  type BuildAndInstallOptions,
  buildAndInstall as defaultBuildAndInstall,
  type OrchestratorResult,
} from "../io/orchestrator";
import {
  canonicalRegistryPath,
  loadRegistry as defaultLoadRegistry,
  type Registry,
  resolveAllSources,
} from "../io/registry";
import { defaultRemoveHeartbeat, defaultWriteHeartbeat } from "./heartbeat";
import { type TtlAgent, tickRefreshLoop } from "./refresh-loop";
import { startWatcher as defaultStartWatcher } from "./watcher";

export interface DaemonDeps {
  loadRegistry?: () => Promise<Registry>;
  loadAllBundles?: (reg: Registry) => Promise<LoadAllBundlesResult>;
  buildAndInstall?: (
    bundles: AgentBundle[],
    paths: InstallPaths,
    options?: BuildAndInstallOptions,
  ) => Promise<OrchestratorResult>;
  pullIfClean?: (cwd: string) => Promise<PullResult>;
  startWatcher?: (
    paths: string[],
    opts: { onChange: (paths: string[]) => void },
  ) => { close: () => Promise<void> };
  defaultInstallPaths?: () => InstallPaths;
  /**
   * Factory returning the agent-smith state home directory (where each
   * agent's `refresh-manifest.json` lives). Defaults to the production
   * `defaultAgentSmithHome()` from `../cli/install-paths`. Tests inject a
   * temp dir so they can stage manifests without touching the user's real
   * `~/.config/agent-smith`. Mirrors the `defaultInstallPaths` seam above.
   */
  defaultAgentSmithHome?: () => string;
  log?: (line: string) => void;
  errLog?: (line: string) => void;
  pullIntervalMs?: number;
  /**
   * When true (default), runDaemon registers process-level handlers:
   *   - SIGTERM/SIGINT/SIGHUP → graceful shutdown
   *   - uncaughtException → log via errLog, shutdown, then exit(1)
   *   - unhandledRejection → log via errLog, shutdown, then exit(1)
   *
   * All handlers are removed during shutdown so the daemon can be run
   * multiple times in the same process (e.g. tests, or a long-lived host)
   * without leaking listeners. Tests pass `false` so they don't pollute
   * the test runner's global handler list and so injected exit() doesn't
   * actually terminate bun test.
   */
  installProcessHandlers?: boolean;
  /**
   * Process exit function. Defaults to `process.exit`. Tests inject a no-op
   * so the uncaughtException/unhandledRejection handlers can run to
   * completion without killing the test runner.
   */
  exit?: (code?: number) => never;
  /**
   * Heartbeat interval in milliseconds. Defaults to 5 seconds. Each tick
   * rewrites the heartbeat file with a fresh `lastBeatAt` and the current
   * per-source state snapshot.
   */
  heartbeatIntervalMs?: number;
  /**
   * Heartbeat writer. Default writes atomically (temp + rename) to
   * `~/.config/agent-smith/daemon.heartbeat.json`. Tests pass an in-memory
   * recorder so they don't touch the real filesystem.
   */
  writeHeartbeat?: (snapshot: HeartbeatSnapshot) => Promise<void>;
  /**
   * Heartbeat cleanup. Default removes the heartbeat file. Called once on
   * shutdown so a `status` command after stop reports cleanly.
   */
  removeHeartbeat?: () => Promise<void>;
  /**
   * Cadence for the TTL refresh loop. Defaults to 5 minutes. Deliberately
   * a separate setInterval from the 15-min git-pull loop above — knowledge
   * source refresh and git pull have independent failure modes and tuning
   * needs, so collapsing them onto one interval would couple concerns that
   * should stay isolated (PHASE-5 task 3).
   */
  ttlIntervalMs?: number;
  /**
   * Enumerate (agent, source) pairs whose `refresh` spec normalizes to
   * `mode === "ttl"`. Defaults to scanning the canonical registry +
   * loaded bundles via parseRefresh. Tests inject a stub to avoid
   * loading real bundles from disk.
   */
  enumerateTtlAgents?: () => Promise<TtlAgent[]>;
  /**
   * Per-source refresh primitive. Defaults to the same `refreshOneSource`
   * used by `smith knowledge refresh-session`, so daemon-driven refreshes
   * and session-start refreshes share identical success/failure semantics.
   */
  refreshSource?: (
    agent: string,
    sourceId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Cache root used for the refresh-cache entries the TTL loop reads and
   * writes. Defaults to the same root the CLI uses
   * (XDG_CACHE_HOME/agent-smith or ~/.cache/agent-smith).
   */
  refreshCacheRoot?: () => string;
  /**
   * Resolve the absolute path to the smith binary the daemon was launched
   * with. Defaults to `process.argv[1]`. Tests inject a synthetic path so
   * the staleness check can be exercised without filesystem mutation.
   */
  binPath?: () => string;
  /**
   * Stat the binary at `binPath()` and return mtimeMs. Returns null if the
   * file does not exist or cannot be statted. Defaults to a wrapper around
   * `node:fs/promises.stat`.
   */
  statBin?: () => Promise<{ mtimeMs: number } | null>;
}

export interface DaemonHandle {
  /**
   * Stop the daemon: clear the pull interval, close the watcher, await any
   * in-flight reinstall, and return. Idempotent — calling twice is safe.
   */
  shutdown: () => Promise<void>;
  /**
   * Snapshot of the per-source pull state. Only sources that are
   * git-pullable (kind === "registered" with a gitRemote) appear in the map.
   * Returned map is a copy; mutating it has no effect on the daemon.
   */
  getState: () => Map<string, SourceState>;
}

/**
 * Per-source health state, surfaced via DaemonHandle.getState() so callers
 * (tests, future `smith status` command) can inspect daemon health without
 * scraping logs.
 *
 * - "idle": last pull was clean (or no pull has happened yet).
 * - "pulling": pull in flight on this source.
 * - "dirty": last pull skipped because the working tree had uncommitted
 *   changes. Reinstall is intentionally suppressed for this source.
 * - "error": last pull failed (network, auth, etc.). Reinstall suppressed.
 */
export type SourceState = "idle" | "pulling" | "dirty" | "error";

/**
 * On-disk heartbeat snapshot. Written atomically by the daemon every
 * `heartbeatIntervalMs` (default 5s). Consumed by `daemon status` and
 * external monitors to distinguish "process exists but is wedged" from
 * "process exists and is healthy".
 *
 * - `pid`: the daemon's process id, useful for log correlation.
 * - `startedAt`: ms epoch when runDaemon completed initial install. Stable
 *   across the daemon's lifetime.
 * - `lastBeatAt`: ms epoch of the most recent heartbeat write. A `status`
 *   command can compute staleness as `now - lastBeatAt`.
 * - `sources`: snapshot of per-source pull state. Keys are source labels.
 *   Only git-pullable sources appear.
 */
export type HeartbeatStatus = "installing" | "ready" | "degraded";

export interface HeartbeatSnapshot {
  schemaVersion: 1 | 2;
  pid: number;
  startedAt: number;
  lastBeatAt: number;
  status?: HeartbeatStatus;
  sources: Record<string, SourceState>;
}

/**
 * Backward-compat alias: the old DaemonOptions only carried pullIntervalMs.
 */
export type DaemonOptions = Pick<DaemonDeps, "pullIntervalMs">;

export async function runDaemon(deps: DaemonDeps = {}): Promise<DaemonHandle> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const errLog = deps.errLog ?? ((line: string) => console.error(line));
  const loadRegistry = deps.loadRegistry ?? (() => defaultLoadRegistry(canonicalRegistryPath()));
  const loadAllBundles = deps.loadAllBundles ?? defaultLoadAllBundles;
  const buildAndInstall = deps.buildAndInstall ?? defaultBuildAndInstall;
  const pullIfClean = deps.pullIfClean ?? defaultPullIfClean;
  const startWatcher = deps.startWatcher ?? defaultStartWatcher;
  const installPaths = deps.defaultInstallPaths ?? defaultInstallPaths;
  // Store the resolver, not the resolved value, so doReinstall observes
  // any env changes mid-daemon-life — matches the installPaths pattern
  // immediately above and the contract the DaemonDeps JSDoc claims to
  // mirror.
  const getAgentSmithHome = deps.defaultAgentSmithHome ?? defaultAgentSmithHomeImpl;
  const pullIntervalMs = deps.pullIntervalMs ?? 15 * 60 * 1000;
  const installProcessHandlers = deps.installProcessHandlers ?? true;
  const exit: (code?: number) => never = deps.exit ?? ((code?: number) => process.exit(code));
  const heartbeatIntervalMs = deps.heartbeatIntervalMs ?? 5_000;
  const writeHeartbeat = deps.writeHeartbeat ?? defaultWriteHeartbeat;
  const removeHeartbeat = deps.removeHeartbeat ?? defaultRemoveHeartbeat;
  const ttlIntervalMs = deps.ttlIntervalMs ?? 5 * 60 * 1000;
  const refreshSource = deps.refreshSource ?? defaultRefreshOneSource;
  const refreshCacheRoot = deps.refreshCacheRoot ?? defaultRefreshCacheRoot;
  const binPath = deps.binPath ?? (() => process.argv[1] ?? "");
  const statBin =
    deps.statBin ??
    (async () => {
      try {
        const { stat } = await import("node:fs/promises");
        const path = binPath();
        if (!path) return null;
        const s = await stat(path);
        return { mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    });
  const selfRestartDisabled = process.env.SMITH_NO_DAEMON_SELF_RESTART === "1";
  const startupBinSnapshot = await statBin();
  const enumerateTtlAgents =
    deps.enumerateTtlAgents ??
    (async (): Promise<TtlAgent[]> => {
      // Note: bundle-load failures are already reported by the startup
      // path and the pull-loop's doReinstall(). Re-emitting them on every
      // TTL tick (default 5min) would produce 12 duplicate warnings/hour
      // for a persistently-broken bundle, which is pure noise.
      const r = await loadAllBundles(await loadRegistry());
      const out: TtlAgent[] = [];
      for (const b of r.bundles) {
        const ttlSources = (b.config.knowledge?.sources ?? [])
          .map((s) => {
            const n = parseRefresh(s.refresh);
            if (n.mode !== "ttl" || n.ttlMs === undefined) return undefined;
            return { id: s.id, ttlMs: n.ttlMs };
          })
          .filter((x): x is { id: string; ttlMs: number } => x !== undefined);
        if (ttlSources.length > 0) {
          out.push({ name: b.config.name, sources: ttlSources });
        }
      }
      return out;
    });

  const reg = await loadRegistry();
  log(`${pc.green("smith daemon")} started; watching ${reg.sources.length} agent catalogs`);

  // Single-flight reinstall: if a reinstall is in flight, new triggers (from
  // chokidar's onChange callback or the pull interval) set rerunPending
  // instead of starting a concurrent run. On completion, if the flag was
  // set, we run once more — collapsing burst triggers to at most one rerun
  // and preventing concurrent buildAndInstall invocations from racing on
  // file writes (DAEMON-6, DAEMON-7).
  let inFlight: Promise<void> | null = null;
  let rerunPending = false;
  // Mirrors `inFlight` for the TTL refresh tick below. setInterval schedules
  // an async IIFE every tick; clearInterval stops FUTURE ticks but does not
  // await a tick that's already mid-flight. Without tracking the in-flight
  // tick, shutdown() can return while refreshSource is still pending — leaking
  // cache writes and network IO past daemon shutdown. shutdown() awaits this
  // before removeHeartbeat() so the "daemon is done" signal is honest.
  let inFlightTtl: Promise<void> | null = null;

  // Install destination paths we've written. Used by the watcher
  // suppression layer (followup #16) to distinguish self-write echoes
  // from real user edits. Grows monotonically across reinstalls; the
  // bound is total installed file count, which is small in practice.
  const installDestPaths = new Set<string>();

  // D.1: tracks whether the last install succeeded or failed, used to
  // determine the heartbeat status field.
  let lastInstallOk = true;

  // Layer 2 self-staleness check (followup #20). On each reinstall tick we
  // re-stat the smith binary; if its mtime moved past startup, an upgrade
  // happened underneath us and our in-memory schema is potentially behind
  // the on-disk binary. We schedule a clean shutdown + exit(0) on the next
  // microtask so the current reinstall path can return cleanly first. The
  // microtask defer also lets us reference `shutdown` (declared later in
  // this function) — by the time the microtask runs, the `const shutdown`
  // binding is initialized.
  const checkBinaryStalenessAndScheduleExit = async (): Promise<boolean> => {
    if (selfRestartDisabled || startupBinSnapshot === null) return false;
    const current = await statBin();
    if (current === null) return false;
    if (current.mtimeMs <= startupBinSnapshot.mtimeMs) return false;
    log(
      "smith binary updated since daemon start; exiting cleanly so a fresh process can take over",
    );
    // Defer the shutdown+exit so the caller can return cleanly first.
    queueMicrotask(() => {
      void shutdown().finally(() => exit(0));
    });
    return true;
  };

  const doReinstall = async (): Promise<void> => {
    try {
      if (await checkBinaryStalenessAndScheduleExit()) return;
      const result = await loadAllBundles(await loadRegistry());
      warnAllLoadFailures(result.failures, errLog);
      // Repopulate the per-bundle refresh-hooks opt-in map from each
      // bundle's persisted refresh-manifest.json. Without this, the
      // orchestrator's fail-closed default would silently strip any
      // previously-consented Claude Code SessionStart hook on every
      // daemon-driven reinstall (PHASE-5 task 0).
      const withRefreshHooksFor = await buildRefreshHooksMap(getAgentSmithHome(), result.bundles);
      const r = await buildAndInstall(result.bundles, installPaths(), {
        withRefreshHooksFor,
      });
      // Record every path we just wrote so subsequent chokidar events
      // for those paths can be recognized as self-write echoes.
      for (const i of r.installed) installDestPaths.add(i.path);
      if (r.errors.length > 0) {
        for (const e of r.errors) errLog(`${pc.red("FAIL")} ${e.agent} ${e.messages.join("; ")}`);
        lastInstallOk = false;
      } else {
        log(`${pc.dim(new Date().toISOString())} installed ${r.installed.length} files`);
        lastInstallOk = true;
      }
    } catch (err) {
      errLog(`${pc.red("daemon error")} ${err instanceof Error ? err.message : String(err)}`);
      lastInstallOk = false;
    }
  };

  const reinstall = (): Promise<void> => {
    if (inFlight) {
      if (!rerunPending) {
        rerunPending = true;
        log(pc.dim("reinstall in-flight; collapsing trigger into one rerun"));
      }
      return inFlight;
    }
    inFlight = (async () => {
      try {
        await doReinstall();
        // Drain the rerun-pending flag in a loop so a trigger that arrived
        // during the rerun itself also gets coalesced into one further run.
        while (rerunPending) {
          rerunPending = false;
          await doReinstall();
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  // Self-write suppression (followup #16). Wraps the chokidar callback:
  // if EVERY changed path is in our install-destination set, the event
  // is a self-write echo from our own install — drop it. If ANY path
  // is outside, treat it as a real user edit and reinstall (so a mixed
  // batch of self-writes + user edits doesn't lose the user edit).
  const onWatcherChange = (paths: string[]): void => {
    if (paths.length === 0) {
      // Defensive: empty batch shouldn't happen but if it does, reinstall
      // (matches previous behavior where any chokidar event triggered).
      void reinstall();
      return;
    }
    const allEchoes = paths.every((p) => installDestPaths.has(p));
    if (allEchoes) {
      log(
        pc.dim(`watcher: dropped ${paths.length} self-write echo${paths.length === 1 ? "" : "es"}`),
      );
      return;
    }
    void reinstall();
  };
  const watchPaths = (await resolveAllSources(reg)).map((s) => s.rootPath);
  const watcher = startWatcher(watchPaths, { onChange: onWatcherChange });

  // Per-source pull state (DAEMON-5). Only git-pullable sources appear here.
  // The pull loop logs ONCE on each transition (idle→dirty, dirty→idle, etc.)
  // so a long-running uncommitted change in a registered source doesn't spam
  // the log every 15 minutes.
  const sourceState = new Map<string, SourceState>();
  for (const s of reg.sources) {
    if (s.kind === "registered" && s.gitRemote) {
      sourceState.set(s.label, "idle");
    }
  }

  const transition = (label: string, next: SourceState, message?: string): void => {
    const prev = sourceState.get(label);
    if (prev === next) return;
    sourceState.set(label, next);
    if (message) {
      // dirty/error are warnings (stderr); recovery is info (stdout).
      if (next === "dirty" || next === "error") errLog(message);
      else log(message);
    }
  };

  const interval = setInterval(async () => {
    for (const s of reg.sources) {
      if (s.kind !== "registered" || !s.gitRemote) continue;
      // Capture state BEFORE the in-flight "pulling" marker so we can detect
      // recovery (anything-but-idle → idle) on completion.
      const stateBeforeTick = sourceState.get(s.label) ?? "idle";
      sourceState.set(s.label, "pulling");
      const r = await pullIfClean(s.rootPath);
      if (r.status === "clean") {
        // We unconditionally set "pulling" above; restore the real prior
        // state so transition() can detect a recovery.
        sourceState.set(s.label, stateBeforeTick);
        if (stateBeforeTick !== "idle") {
          transition(
            s.label,
            "idle",
            `${pc.green("recovered")} ${s.label}: pull resumed (back to clean)`,
          );
        } else {
          transition(s.label, "idle");
        }
        log(`${pc.dim("pulled")} ${s.label}`);
        await reinstall();
      } else if (r.status === "dirty") {
        sourceState.set(s.label, stateBeforeTick);
        transition(
          s.label,
          "dirty",
          `${pc.yellow("warn")} ${s.label}: working tree has uncommitted changes; skipping pull`,
        );
      } else {
        sourceState.set(s.label, stateBeforeTick);
        transition(s.label, "error", `${pc.red("pull error")} ${s.label}: ${r.message}`);
      }
    }
  }, pullIntervalMs);

  // Heartbeat setup (must come BEFORE initial reinstall — see Appendix C of
  // .docs/2026-05-27-gui-daemon-start-state-root-split.md).
  // Initial install can take tens of seconds for bundles with Confluence/
  // large URL knowledge sources; daemonStart's parent only waits 10s for the
  // heartbeat to appear. Establishing the heartbeat first means the parent
  // sees "alive" within milliseconds of spawn, regardless of install time.
  const startedAt = Date.now();
  let lastInstallStatus: "installing" | "ready" | "degraded" = "installing";
  const snapshot = (): HeartbeatSnapshot => ({
    schemaVersion: 2,
    pid: process.pid,
    startedAt,
    lastBeatAt: Date.now(),
    status: lastInstallStatus,
    sources: Object.fromEntries(sourceState),
  });

  // Initial write — we deliberately set lastBeatAt = startedAt so the
  // first snapshot has a stable, equal pair. Subsequent ticks update
  // lastBeatAt.
  await writeHeartbeat({ ...snapshot(), lastBeatAt: startedAt });

  const heartbeatInterval = setInterval(() => {
    void writeHeartbeat(snapshot()).catch((err) => {
      // Heartbeat write failures shouldn't crash the daemon — log and
      // continue. A persistent failure (e.g. disk full) will surface
      // through the absence of fresh lastBeatAt to whoever's watching.
      errLog(`${pc.red("heartbeat error")} ${err instanceof Error ? err.message : String(err)}`);
    });
  }, heartbeatIntervalMs);

  // Initial install. Runs AFTER heartbeat is established so the parent's
  // start-verification poll succeeds even when install takes 40+ seconds.
  // doReinstall() has its own try/catch, so install failure cannot crash
  // the daemon. runDaemon still resolves after this await completes — the
  // 29 existing callers that depend on post-install state (sources map,
  // install destinations, etc.) are unaffected.
  //
  // D.4: Watchdog logs every 30s while the initial install is in flight,
  // giving operators a debugging trail for stuck installs.
  const installStart = Date.now();
  const watchdog = setInterval(() => {
    log(
      pc.yellow(
        `initial install still running after ${Math.round((Date.now() - installStart) / 1000)}s`,
      ),
    );
  }, 30_000);
  try {
    await reinstall();
    lastInstallStatus = lastInstallOk ? "ready" : "degraded";
    await writeHeartbeat(snapshot());
  } finally {
    clearInterval(watchdog);
  }

  // TTL refresh loop (PHASE-5 task 3). Dedicated interval, INDEPENDENT of
  // the 15-min git-pull loop above — refresh cadence and pull cadence are
  // tuned separately and have orthogonal failure modes. The whole tick body
  // is wrapped in a try/catch so a thrown error from enumeration or any
  // refresh call cannot crash the daemon.
  const ttlInterval = setInterval(() => {
    // Skip if the previous tick is still running. Avoids unbounded fan-out
    // when refreshSource is slow relative to ttlIntervalMs — overlapping
    // ticks could otherwise pile up indefinitely on a slow filesystem or
    // network. Also makes the shutdown await below a single-promise wait.
    if (inFlightTtl) return;
    inFlightTtl = (async () => {
      try {
        const agents = await enumerateTtlAgents();
        const result = await tickRefreshLoop({
          now: Date.now(),
          cacheRoot: refreshCacheRoot(),
          agents,
          refreshSource,
        });
        if (result.refreshed.length > 0) {
          log(`${pc.dim("refreshed")} ${result.refreshed.length} ttl source(s)`);
        }
        for (const f of result.failed) {
          errLog(`${pc.red("refresh error")} ${f.agent}/${f.sourceId}: ${f.error}`);
        }
      } catch (err) {
        errLog(`${pc.red("ttl tick error")} ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        inFlightTtl = null;
      }
    })();
  }, ttlIntervalMs);

  let shutdownDone = false;
  // Process-level handler refs we register so we can remove them on
  // shutdown. Initialized to no-ops so the cleanup loop works even when
  // installProcessHandlers is false.
  let onUncaught: ((err: Error) => void) | null = null;
  let onUnhandled: ((reason: unknown) => void) | null = null;
  let onSigterm: (() => void) | null = null;
  let onSigint: (() => void) | null = null;
  let onSighup: (() => void) | null = null;

  const shutdown = async (): Promise<void> => {
    if (shutdownDone) return;
    shutdownDone = true;
    // Snapshot the in-flight TTL tick BEFORE clearing the interval. After
    // clearInterval no new tick can start (so inFlightTtl can't be reassigned
    // to a fresher promise), but taking the snapshot here keeps the reasoning
    // local: "this is the tick that was running when shutdown began."
    const pendingTtl = inFlightTtl;
    clearInterval(interval);
    clearInterval(heartbeatInterval);
    clearInterval(ttlInterval);
    await watcher.close();
    // Drain any in-flight reinstall (and any pending rerun queued during it)
    // before resolving — callers (signal handlers, tests) rely on shutdown
    // not returning until the daemon is genuinely idle.
    if (inFlight) await inFlight;
    // Mirror the inFlight pattern for the TTL tick: setInterval scheduled an
    // async IIFE that clearInterval cannot await. Without this drain, a tick
    // that fired just before shutdown can complete refreshSource (cache writes,
    // network IO) AFTER shutdown returns — violating the daemon-is-idle
    // contract and producing observable test flakes.
    if (pendingTtl) await pendingTtl;
    // Best-effort heartbeat-file removal so a `daemon status` call after
    // shutdown reports cleanly. Errors are logged but don't block shutdown.
    try {
      await removeHeartbeat();
    } catch (err) {
      errLog(
        `${pc.red("heartbeat cleanup error")} ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Remove every process-level handler we registered so re-running the
    // daemon in the same process (tests, long-lived hosts) doesn't leak.
    if (onUncaught) process.off("uncaughtException", onUncaught);
    if (onUnhandled) process.off("unhandledRejection", onUnhandled);
    if (onSigterm) process.off("SIGTERM", onSigterm);
    if (onSigint) process.off("SIGINT", onSigint);
    if (onSighup) process.off("SIGHUP", onSighup);
  };

  if (installProcessHandlers) {
    // Top-level error handlers (DAEMON-1, DAEMON-8). Without these, an
    // uncaught throw or unhandled rejection from inside the watcher's
    // callback or anywhere on the event loop would kill the process
    // immediately — leaving the pid file behind, the watcher unclosed,
    // and the operator with no useful log line. Now we log the error,
    // drain shutdown, then exit(1).
    onUncaught = (err: Error) => {
      errLog(
        `${pc.red("uncaughtException")} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      void shutdown().finally(() => exit(1));
    };
    onUnhandled = (reason: unknown) => {
      const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
      errLog(`${pc.red("unhandledRejection")} ${msg}`);
      void shutdown().finally(() => exit(1));
    };
    onSigterm = () => {
      log(pc.dim("received SIGTERM; shutting down"));
      void shutdown().finally(() => exit(0));
    };
    onSigint = () => {
      log(pc.dim("received SIGINT; shutting down"));
      void shutdown().finally(() => exit(0));
    };
    onSighup = () => {
      log(pc.dim("received SIGHUP; shutting down"));
      void shutdown().finally(() => exit(0));
    };
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);
    process.on("SIGHUP", onSighup);
  }

  return {
    shutdown,
    // Return a copy so callers can't mutate the daemon's internal map.
    getState: () => new Map(sourceState),
  };
}
