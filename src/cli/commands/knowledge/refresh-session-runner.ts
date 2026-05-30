import {
  mergeCacheEntry,
  readRefreshCache,
  writeRefreshCache,
} from "../../../core/knowledge/refresh-cache";
import { acquireRefreshLock, releaseRefreshLock } from "../../../core/knowledge/refresh-lock";
import { parseRefresh } from "../../../core/knowledge/refresh-spec";
import type { RefreshSpec } from "../../../core/knowledge/types";
import type { Target } from "../../../core/types";
import { defaultCacheRoot } from "../../../io/cache-root";

/** Re-exported so existing consumers that import `defaultCacheRoot` from this
 *  module continue to work. Canonical definition lives in src/io/cache-root.ts. */
export { defaultCacheRoot };

/** Identifies which platform an invocation belongs to. Used to scope a
 *  refresh-session run to agents that actually target that platform (e.g.
 *  a codex SessionStart hook should not touch claude-code-only agents).
 *  Defined here (upstream of both refresh-session.ts and
 *  refresh-session-agents.ts) so both modules can import without
 *  introducing a circular dependency. */
export type PlatformFilter = Target | undefined;

/** A minimal source descriptor the runner needs. Real callsites pass a richer object;
 *  the runner only reads these fields. */
export interface RunnerSource {
  id: string;
  refresh?: RefreshSpec;
}

export interface RunnerAgent {
  name: string;
  /** Platforms this agent targets, sourced from `bundle.config.targets`.
   *  The runner itself does not filter on this; `listInstalledAgentsForRefresh`
   *  uses it to honour `--platform <id>` scoping before constructing the
   *  RunnerAgent list. Kept on the type so any future runner-level
   *  filtering can rely on it without re-loading bundles. */
  targets: Target[];
  sources: RunnerSource[];
}

export type RefreshSourceFn = (
  agent: string,
  sourceId: string,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export interface RunRefreshSessionInput {
  agents: RunnerAgent[];
  refreshSource: RefreshSourceFn;
  /** Global wall-clock budget for the entire invocation, in ms. */
  budgetMs: number;
  /** When set, restrict to this agent's sources only. */
  agentFilter?: string;
  /** Cache root for the per-source advisory lock files. Locks live at
   *  `<lockDir>/locks/<agent>-<sourceId>.lock`. Defaults to
   *  `~/.cache/agent-smith` so concurrent invocations across the user's
   *  smith installs coordinate. Tests override with a tmpdir. */
  lockDir?: string;
  /** Cache root for per-source `.meta.json` refresh-cache files. Defaults to
   *  `~/.cache/agent-smith` (honoring `XDG_CACHE_HOME`). Tests override with
   *  a tmpdir. */
  cacheRoot?: string;
  /** Error logger for cache-write failures. Cache writes are best-effort:
   *  failures don't promote the refresh result to failed (the underlying
   *  refresh may have succeeded), they just get logged so operators can
   *  detect disk-full / permission issues. Default writes to `console.error`.
   *  Daemon callers should pass through their own `errLog`. */
  errLog?: (msg: string) => void;
}

export interface RefreshResult {
  refreshed: Array<{ agent: string; sourceId: string; durationMs: number }>;
  failed: Array<{ agent: string; sourceId: string; error: string }>;
  skipped: Array<{ agent: string; sourceId: string; reason: string }>;
  totalDurationMs: number;
}

/** Modes that trigger a session-time refresh. */
const SESSION_MODES = new Set(["session", "always"]);

/** Run the per-source refreshes in parallel with a global wall-clock budget.
 *  Soft-fails on every source error. Never throws. */
export async function runRefreshSession(input: RunRefreshSessionInput): Promise<RefreshResult> {
  const start = Date.now();
  const result: RefreshResult = {
    refreshed: [],
    failed: [],
    skipped: [],
    totalDurationMs: 0,
  };

  // Collect work units, filtering by agent + mode.
  const work: Array<{ agent: string; source: RunnerSource }> = [];
  for (const agent of input.agents) {
    if (input.agentFilter && agent.name !== input.agentFilter) continue;
    for (const source of agent.sources) {
      const normalized = parseRefresh(source.refresh);
      if (!SESSION_MODES.has(normalized.mode)) {
        result.skipped.push({
          agent: agent.name,
          sourceId: source.id,
          reason: `mode=${normalized.mode}`,
        });
        continue;
      }
      work.push({ agent: agent.name, source });
    }
  }

  if (work.length === 0) {
    result.totalDurationMs = Date.now() - start;
    return result;
  }

  // Run all in parallel; each one races itself against a per-task budget
  // timer computed from the global wall-clock. The timer is cleared in a
  // `finally` so source-wins-race never leaves a pending handle (which
  // would otherwise keep the event loop alive for the full budgetMs).
  const lockDir = input.lockDir ?? defaultCacheRoot();
  const runs = work.map(async ({ agent, source }) => {
    // Per-source advisory lock — skip if another invocation holds it.
    const lockHandle = await acquireRefreshLock(lockDir, agent, source.id);
    if (!lockHandle) {
      result.skipped.push({
        agent,
        sourceId: source.id,
        reason: "lock-held",
      });
      return;
    }
    const sourceStart = Date.now();
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const racePromise = input.refreshSource(agent, source.id);
      const budgetPromise = new Promise<{ ok: false; error: string; budgetTimeout: true }>(
        (resolve) => {
          const remaining = Math.max(0, input.budgetMs - (Date.now() - start));
          budgetTimer = setTimeout(() => {
            resolve({
              ok: false,
              error: `exceeded ${input.budgetMs}ms budget`,
              budgetTimeout: true,
            });
          }, remaining);
        },
      );
      const outcome = await Promise.race([racePromise, budgetPromise]);
      if (outcome.ok) {
        result.refreshed.push({
          agent,
          sourceId: source.id,
          durationMs: Date.now() - sourceStart,
        });
      } else {
        result.failed.push({ agent, sourceId: source.id, error: outcome.error });
      }
      // Persist refresh-cache (.meta.json) under the per-source lock so
      // concurrent invocations don't race on the same file. Skip on
      // budget-timeout: refreshSource() may still be in flight; recording
      // last_error="exceeded budget" would mislead the daemon's TTL retry
      // logic (Phase 5 Task 3). Real refresh failures (refreshSource
      // returned ok:false) and successes always write.
      if (!("budgetTimeout" in outcome && outcome.budgetTimeout)) {
        try {
          const cacheRoot = input.cacheRoot ?? defaultCacheRoot();
          const now = new Date().toISOString();
          const prior = await readRefreshCache(cacheRoot, agent, source.id);
          const entry = mergeCacheEntry({ now, outcome, prior });
          await writeRefreshCache(cacheRoot, agent, source.id, entry);
        } catch (err) {
          const errLog = input.errLog ?? ((m: string) => console.error(m));
          errLog(
            `cache write failed for ${agent}/${source.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      result.failed.push({
        agent,
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      // Always release — timeouts/errors must not leave stale locks.
      await releaseRefreshLock(lockHandle);
    }
  });

  await Promise.all(runs);
  result.totalDurationMs = Date.now() - start;
  return result;
}
