import { sniffParentProfile } from "../../../core/process/ppid-sniff";
import {
  type PlatformFilter,
  type RefreshSourceFn,
  type RunnerAgent,
  runRefreshSession,
} from "./refresh-session-runner";

export type { PlatformFilter } from "./refresh-session-runner";

export interface RefreshSessionOpts {
  agent?: string;
  /** When true, emit JSON to stdout (consumed by hook wrappers). Default false. */
  json?: boolean;
  /** Override global budget in ms. Default 5000. */
  timeout?: number;
  /** Platform that invoked us (e.g. claude-code SessionStart hook, codex
   *  SessionStart hook). When set, refresh is scoped to agents that target
   *  this platform. When `platform === "codex"` and `agent` is not set, the
   *  parent process is sniffed for `--profile <name>` to scope to a single
   *  agent (see `resolveRefreshScope`). */
  platform?: PlatformFilter;
}

export interface RefreshSessionDeps {
  /** Enumerate installed agents and their sources. Receives an optional
   *  platform filter so the implementation can scope at load time. */
  listAgents: (platform?: PlatformFilter) => Promise<RunnerAgent[]>;
  /** Refresh one source. Production impl re-runs the install pipeline; tests pass mocks. */
  refreshSource: RefreshSourceFn;
  /** stdout sink — defaults to console.log in production. */
  log: (msg: string) => void;
  /** stderr sink — defaults to console.error in production. */
  err: (msg: string) => void;
}

const DEFAULT_BUDGET_MS = 5000;

/** Inputs to `resolveRefreshScope`. `sniff` is an injection seam for tests
 *  so they don't have to spawn a parent process. */
export interface RefreshScopeOpts {
  agent?: string;
  platform?: PlatformFilter;
  /** Override the codex parent-process sniffer (tests only). */
  sniff?: () => Promise<string | undefined>;
}

/** The resolved scope of a refresh-session run: which single agent (if any)
 *  to restrict to, and which platform's installed-agent set to consider. */
export interface RefreshScope {
  agent: string | undefined;
  platformFilter: PlatformFilter;
}

/** Decide the (agent, platformFilter) scope for a refresh-session run.
 *
 *  Precedence:
 *  1. Explicit `--agent <name>` always wins — no sniff, no inference.
 *  2. `--platform codex` without `--agent`: sniff the parent process for
 *     `--profile <name>` (codex's per-profile flag) and scope to that agent
 *     if found. On miss, leave `agent` undefined so the caller refreshes
 *     all codex-targeted agents.
 *  3. `--platform claude-code|opencode` (or no platform): no sniff; pass
 *     the platform filter through unchanged. */
export async function resolveRefreshScope(
  opts: RefreshScopeOpts,
): Promise<RefreshScope> {
  if (opts.agent !== undefined) {
    return { agent: opts.agent, platformFilter: opts.platform };
  }
  if (opts.platform === "codex") {
    const sniff = opts.sniff ?? sniffParentProfile;
    const profile = await sniff();
    return { agent: profile, platformFilter: "codex" };
  }
  return { agent: undefined, platformFilter: opts.platform };
}

/** `smith knowledge refresh-session [--agent X] [--json] [--timeout MS]`
 *  Always returns exit code 0 unless arg-parsing fails (commander handles that).
 *  Source failures appear on stderr and (with --json) in the structured output. */
export async function knowledgeRefreshSession(
  opts: RefreshSessionOpts,
  deps: RefreshSessionDeps,
): Promise<number> {
  // Defensive: commander's parseInt parser produces NaN on malformed input
  // (e.g. `--timeout abc`). `??` doesn't catch NaN, so without this guard
  // NaN would propagate to setTimeout where Node coerces it to 1ms, making
  // every source instantly fail with "exceeded NaNms budget". Fall back to
  // the default and warn on stderr instead.
  let budgetMs = opts.timeout ?? DEFAULT_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    deps.err(
      `smith knowledge refresh-session: invalid --timeout '${opts.timeout}', falling back to ${DEFAULT_BUDGET_MS}ms`,
    );
    budgetMs = DEFAULT_BUDGET_MS;
  }

  const scope = await resolveRefreshScope({
    ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
    ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
  });

  const agents = await deps.listAgents(scope.platformFilter);
  const result = await runRefreshSession({
    agents,
    refreshSource: deps.refreshSource,
    budgetMs,
    ...(scope.agent !== undefined ? { agentFilter: scope.agent } : {}),
  });

  // One stderr line per failure (consumed by hook systemMessage surface).
  // Format mirrors the `wrap()` headline convention so hook log surfaces
  // stay visually consistent with other smith CLI errors.
  for (const f of result.failed) {
    deps.err(
      `smith knowledge refresh-session: ${f.agent}/${f.sourceId}: ${f.error}`,
    );
  }

  if (opts.json) {
    deps.log(JSON.stringify(result));
  }

  // Always 0 — soft-fail at every layer.
  return 0;
}
