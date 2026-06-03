import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { urlCacheKey as defaultUrlCacheKey } from "../../../core/knowledge/acquire";
import {
  acquireSource as defaultAcquireSource,
  isAcquirable as defaultIsAcquirable,
} from "../../../core/knowledge/acquire-source";
import { probeRoute } from "../../../core/knowledge/probe-route";
import {
  readRefreshCache as defaultReadRefreshCache,
  writeRefreshCache as defaultWriteRefreshCache,
  mergeCacheEntry,
} from "../../../core/knowledge/refresh-cache";
import type {
  RefreshSourceOpts,
  RefreshSourceResult,
} from "../../../core/knowledge/refresh-source";
import { refreshSource as defaultRefreshSource } from "../../../core/knowledge/refresh-source";
import {
  loadRouteCache as defaultLoadRouteCache,
  recordRoute as recordCacheRoute,
  type RouteCache,
  saveRouteCache,
} from "../../../core/knowledge/route-cache";
import { extractMetaClaims, type MetaClaim } from "../../../core/knowledge/route-meta";
import { SmithError } from "../../../core/smith-error";
import { defaultCacheRoot } from "../../../io/cache-root";
import { cacheDirFor, type KnowledgePaths } from "../../../io/knowledge-paths";
import type { McpClientOpts } from "../../../io/mcp-client";
import { McpClientPool } from "../../../io/mcp-client-pool";
import type { AvailableMap } from "../../../io/mcp-config-readers";
import { createSpawnOptsResolver } from "../../../io/mcp-spawn-resolver";
import { canonicalRegistryPath, loadRegistry as defaultLoadRegistry } from "../../../io/registry";
import { rerenderPrompts as defaultRerenderPrompts } from "../../../io/rerender-prompts";
import { stateHome } from "../../../io/state-home";
import { assertValidAgentName } from "../../agent-name";
import { defaultKnowledgePaths } from "../../install-paths";
import { loadAllBundles as defaultLoadAllBundles } from "../../load-all";
import { install } from "../install";

export interface KnowledgeFetchDeps {
  install: typeof install;
  loadRegistry?: typeof defaultLoadRegistry;
  loadAllBundles?: typeof defaultLoadAllBundles;
  acquireSource?: typeof defaultAcquireSource;
  isAcquirable?: typeof defaultIsAcquirable;
  writeRefreshCache?: typeof defaultWriteRefreshCache;
  readRefreshCache?: typeof defaultReadRefreshCache;
  urlCacheKey?: typeof defaultUrlCacheKey;
  knowledgePaths?: KnowledgePaths;
  now?: () => string;
  cacheRoot?: () => string;
  refreshSource?: (opts: RefreshSourceOpts) => Promise<RefreshSourceResult>;
  rerenderPrompts?: (agent: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Read available MCP servers (for via-routed sources). Tests inject to
   *  avoid touching the real `$HOME`. When provided, the live spawn-opts
   *  resolver is skipped — the test must wire its own resolver via the
   *  injected `refreshSource` / `acquireSource` stubs if it needs one. */
  readAvailableMcpServers?: () => Promise<AvailableMap>;
  /** Phase 3 DI seam for the per-user routing cache loader. Production
   *  omits and gets `loadRouteCache({ stateHome: stateHome() })`; tests
   *  inject a fake to avoid touching the real
   *  `~/.config/agent-smith/url-routing.json`. */
  loadRouteCache?: () => Promise<RouteCache>;
  /** TTY detector DI seam (defaults to `process.stdin.isTTY`). Tests pass
   *  `() => false` to assert the non-interactive path skips probing. */
  isTTY?: () => boolean;
}

/**
 * Re-acquire knowledge sources for an agent and re-install.
 *
 * When `sourceId` is provided, surgically clears ONLY that source's
 * acquirer cache before install so install re-fetches fresh:
 *   - url:  `<cacheDir>/<urlCacheKey(url)>.json` + `.bin` (force: true)
 *   - git:  `<cacheDir>/git/<urlCacheKey(url)>/` (recursive, force: true)
 *   - other types (file/dir/glob/local/npm/confluence/jira): no-op — they
 *     either have no on-disk acquirer cache to clear or are re-acquired
 *     from source every time.
 *
 * Per-source clearing replaces the previous broad `rm(cacheDir, recursive)`
 * which destroyed unrelated sources' caches (e.g. asking smith to refresh
 * one URL would discard every other URL's etag/body and force a full re-fetch).
 *
 * After `install()` runs, re-acquires each (filtered) source to compute a
 * refresh outcome and writes
 * `~/.cache/agent-smith/agents/<agent>/sources/<id>.meta.json` so the GUI's
 * `loadRefreshCacheEntries()` (KnowledgeIndex / RefreshHistory) has data to
 * display. Sources with `delivery: inline | auto` and non-acquirable types
 * (delegated to `isAcquirable()` so new variants in `KnowledgeSourceType`
 * fail the type checker rather than silently writing misleading meta entries)
 * are skipped — they have no on-disk artifact to refresh.
 *
 * Tech debt (Option B): this double-acquires sources because `install()`'s
 * signature is unchanged. Acceptable here because the high-frequency refresh
 * paths (refresh-session-runner, daemon) already write `.meta.json` and are
 * unaffected.
 *
 * `deps` is exposed for testability (bun's `spyOn` cannot reliably patch ES
 * module re-exports, so we inject the IO seams instead).
 */

/**
 * Build a `spawnOptsFor` resolver around a pre-fetched `AvailableMap`. Used
 * when tests inject `readAvailableMcpServers` so via-routed sources still
 * resolve through the test's stubbed map (instead of touching real `$HOME`).
 * Mirrors `createSpawnOptsResolver` but skips the homedir read.
 */
function buildResolverFromMap(map: AvailableMap): (name: string) => McpClientOpts {
  return (name: string): McpClientOpts => {
    const entry = map[name];
    if (!entry) {
      throw new SmithError({
        code: "validation-failed",
        what: `mcp server '${name}'`,
        reasons: [
          `'${name}' is not configured in any platform MCP config (~/.claude.json, ~/.codex/config.toml, ~/.config/opencode/opencode.json, ~/.kiro/settings/mcp.json)`,
          `install it with your platform's documented procedure`,
        ],
      });
    }
    return {
      command: entry.command,
      ...(entry.args ? { args: entry.args } : {}),
      ...(entry.env ? { env: entry.env } : {}),
    };
  };
}

export async function knowledgeFetch(
  agent: string,
  sourceId?: string,
  deps: KnowledgeFetchDeps = { install },
): Promise<number> {
  assertValidAgentName(agent);

  const loadRegistry = deps.loadRegistry ?? defaultLoadRegistry;
  const loadAllBundles = deps.loadAllBundles ?? defaultLoadAllBundles;
  const acquireSource = deps.acquireSource ?? defaultAcquireSource;
  const isAcquirable = deps.isAcquirable ?? defaultIsAcquirable;
  const writeRefreshCache = deps.writeRefreshCache ?? defaultWriteRefreshCache;
  const readRefreshCache = deps.readRefreshCache ?? defaultReadRefreshCache;
  const urlCacheKey = deps.urlCacheKey ?? defaultUrlCacheKey;
  const knowledgePaths = deps.knowledgePaths ?? defaultKnowledgePaths();
  const now = deps.now ?? (() => new Date().toISOString());
  const cacheRoot = deps.cacheRoot ?? defaultCacheRoot;

  // Pool for via-routed URL sources. Lifetime = this command invocation.
  // Both the surgical (--source) path and the broad path's post-install
  // re-acquire can hit `acquireSource` for via-declared sources, so we
  // create a single pool here and shutdown in `finally` so child MCP
  // servers never leak past command exit. Bundles without via-routed
  // sources never trigger an acquire-via path; the pool stays empty.
  const pool = new McpClientPool();
  // Spawn-opts resolver matches install's wiring. When tests inject
  // `readAvailableMcpServers`, build a resolver around the injected map
  // so via-routed sources still resolve; otherwise read from `$HOME`.
  const spawnOptsFor = deps.readAvailableMcpServers
    ? buildResolverFromMap(await deps.readAvailableMcpServers())
    : await createSpawnOptsResolver({ homeDir: homedir() });

  try {
    // Load the bundle ONCE — used for both pre-install per-source clearing
    // (so we know each source's type/url to derive its cache path) and the
    // post-install .meta.json writes. If bundle lookup fails or the agent
    // isn't found, fall through to install() unchanged — install will surface
    // any real misconfiguration. Errors here must NOT abort the command.
    let bundle: Awaited<ReturnType<typeof loadAllBundles>>["bundles"][number] | undefined;
    try {
      const reg = await loadRegistry(canonicalRegistryPath());
      const loadResult = await loadAllBundles(reg);
      bundle = loadResult.bundles.find((b) => b.config.name === agent);
    } catch {
      bundle = undefined;
    }

    if (sourceId && !bundle) {
      console.warn(
        pc.yellow(
          `warning: could not load bundle metadata for ${agent}; ` +
            `skipping per-source cache clear, install will use any existing cache`,
        ),
      );
    }

    // Phase 3: per-user routing cache + _meta claims + probe callback +
    // record callback. Threaded into both the surgical (--source) path
    // (`refreshSource` → `acquireSource`) and the post-install meta-write
    // re-acquire so URL sources without explicit `via:` resolve through
    // the three-layer resolver. Tests inject `loadRouteCache` to avoid
    // touching the user's real `~/.config/agent-smith/url-routing.json`.
    const loadRouteCacheFn =
      deps.loadRouteCache ?? (() => defaultLoadRouteCache({ stateHome: stateHome() }));
    let mutableRouteCache: RouteCache = await loadRouteCacheFn();

    // Layer 2 _meta self-claim collection. Gated behind SMITH_PROBE_META
    // because spawning every declared MCP server up front is expensive
    // (each can take 5-10s with auth handshakes); the probe-on-failure
    // path acquires servers lazily as needed.
    // When tests inject `readAvailableMcpServers`, the spawn-opts resolver
    // was built off the test's stubbed map — eagerly probing declared
    // servers there would spawn real processes for fixture names.
    const allMetaClaims: MetaClaim[] = [];
    if (
      process.env.SMITH_PROBE_META === "1" &&
      bundle &&
      deps.readAvailableMcpServers === undefined
    ) {
      const declaredServers = bundle.config.mcpServers ?? [];
      for (const serverName of declaredServers) {
        try {
          const client = await pool.acquire(serverName, spawnOptsFor(serverName));
          const tools = await client.listTools();
          allMetaClaims.push(...extractMetaClaims(serverName, tools));
        } catch {
          // Server may not be installed locally; preflight covers required vs peer.
        }
      }
    }

    const isTtyForProbe = deps.isTTY ? deps.isTTY() : Boolean(process.stdin.isTTY);
    const bundleMcpServers = bundle?.config.mcpServers ?? [];
    const probeOnFailure = isTtyForProbe
      ? (url: string) =>
          probeRoute({
            url,
            bundleMcpServers,
            pool,
            spawnOptsFor,
            prompt: async (msg: string) => {
              process.stdout.write(msg);
              return new Promise<string>((resolve) => {
                process.stdin.once("data", (b) => resolve(b.toString().trim()));
              });
            },
          })
      : undefined;

    const recordRoute = async (r: { url: string; server: string; tool: string }) => {
      mutableRouteCache = recordCacheRoute(mutableRouteCache, {
        ...r,
        now: new Date().toISOString(),
      });
      await saveRouteCache({ stateHome: stateHome() }, mutableRouteCache);
    };

    const cacheDir = cacheDirFor(agent, knowledgePaths);

    // Pre-install: surgically clear ONLY the requested source's acquirer cache.
    // Per-source paths come from the acquirers themselves (acquire.ts:237-239
    // for url, acquire.ts:367 for git) and are derived via `urlCacheKey`.
    // EACCES / other non-ENOENT errors propagate; install must NOT run with
    // a stale cache the user explicitly asked us to refresh.
    if (sourceId && bundle) {
      const allSources = bundle.config.knowledge?.sources ?? [];
      const target = allSources.filter((s) => s.id === sourceId && isAcquirable(s.type));
      for (const src of target) {
        try {
          if (src.type === "url") {
            const key = urlCacheKey(src.url);
            await rm(join(cacheDir, `${key}.json`), { force: true });
            await rm(join(cacheDir, `${key}.bin`), { force: true });
            console.log(pc.dim(`cleared URL cache for source ${src.id}`));
          } else if (src.type === "git") {
            const key = urlCacheKey(src.url);
            await rm(join(cacheDir, "git", key), { recursive: true, force: true });
            console.log(pc.dim(`cleared git cache for source ${src.id}`));
          }
          // file/dir/glob: no acquirer cache.
          // confluence/jira: cache exists but per-source clear not yet wired —
          // broad refresh still works.
          // (npm is filtered out above by isAcquirable, so never reaches here.)
        } catch (err) {
          // `force: true` already swallows ENOENT, so any error here is a real
          // problem (EACCES on a read-only cache, EROFS, etc.). Surface it with
          // the source id so the user knows which source failed to clear, and
          // skip install — running install with a stale cache the user
          // explicitly asked us to refresh would silently defeat the request.
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`failed to clear cache for source ${src.id}: ${msg}`);
        }
      }
    }

    // Surgical path: when --source is given AND we have a bundle with the
    // source definition, route through refreshSource + rerenderPrompts instead
    // of the full install() rebuild.
    if (sourceId && bundle) {
      const doRefresh = deps.refreshSource ?? defaultRefreshSource;
      const doRerender =
        deps.rerenderPrompts ??
        ((a: string) =>
          defaultRerenderPrompts(a, { agentSmithHome: knowledgePaths.agentSmithHome }));
      const allSources = bundle.config.knowledge?.sources ?? [];
      const source = allSources.find((s) => s.id === sourceId);
      if (source) {
        try {
          await doRefresh({
            agentSmithHome: knowledgePaths.agentSmithHome,
            agent,
            source,
            bundleDir: bundle.bundlePath,
            cacheRoot: cacheDir,
            mcpPool: pool,
            spawnOptsFor,
            routeCache: mutableRouteCache,
            metaClaims: allMetaClaims,
            ...(probeOnFailure ? { probeOnFailure } : {}),
            recordRoute,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(pc.red(`smith: refresh of ${sourceId} for ${agent} failed: ${msg}`));
          console.error(
            "  on-disk knowledge state has been preserved; previous content for this source is intact.",
          );
          return 1;
        }
        const rerender = await doRerender(agent);
        if (!rerender.ok) {
          console.error(pc.red(`smith: rerender failed for ${agent}: ${rerender.error}`));
          return 1;
        }
        return 0;
      }
    }

    const exitCode = await deps.install(agent);

    if (exitCode !== 0) {
      // Don't write meta files when install failed — the on-disk state is
      // the prior successful state (atomic swap preserved it), and the
      // sources we'd write meta for may have never materialized in this
      // run. Writing 'ok: true' meta would lie about disk state.
      console.error(
        pc.red(`smith: knowledge fetch failed for ${agent} (install exit ${exitCode})`),
      );
      console.error(`  on-disk knowledge state has been preserved; previous content is intact.`);
      console.error(`  to retry: smith knowledge fetch ${agent}`);
      return exitCode;
    }

    // Post-install: re-derive outcomes and write .meta.json per source so the
    // GUI's loadRefreshCacheEntries() has data. Best-effort: any error in this
    // block must not change the install exit code (install already succeeded
    // and wrote the bundle; the cache file is a separate artifact).
    try {
      if (!bundle) return exitCode;

      const root = cacheRoot();
      const allSources = bundle.config.knowledge?.sources ?? [];
      const sources = allSources.filter((s) => {
        if (sourceId !== undefined && s.id !== sourceId) return false;
        // inline/auto delivery has no on-disk source artifact to track; skip
        // to match refresh-source.ts's `inline-only` early return.
        if (s.delivery === "inline" || s.delivery === "auto") return false;
        // Delegate the "is this type actually acquirable?" decision to
        // isAcquirable() so its exhaustive switch flags any future
        // KnowledgeSourceType variants at compile time.
        if (!isAcquirable(s.type)) return false;
        return true;
      });

      for (const src of sources) {
        const ts = now();
        const prior = await readRefreshCache(root, agent, src.id);
        let outcome: { ok: true } | { ok: false; error: string };
        try {
          await acquireSource(src, {
            bundleDir: bundle.bundlePath,
            cacheDir,
            mcpPool: pool,
            spawnOptsFor,
            routeCache: mutableRouteCache,
            metaClaims: allMetaClaims,
            ...(probeOnFailure ? { probeOnFailure } : {}),
            recordRoute,
          });
          outcome = { ok: true };
        } catch (err) {
          outcome = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const entry = mergeCacheEntry({ now: ts, outcome, prior });
        await writeRefreshCache(root, agent, src.id, entry);
      }
    } catch (err) {
      // Best-effort: surface a warning but don't fail the command — install
      // already succeeded.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.yellow(`warn: failed to update refresh cache: ${msg}`));
    }

    return exitCode;
  } finally {
    // Pool lifetime ends here so via-routed acquires can finish before we
    // tear down their connections. shutdown() is idempotent and safe even
    // when nothing was acquired (e.g. no via-routed sources in any bundle).
    await pool.shutdown();
  }
}
