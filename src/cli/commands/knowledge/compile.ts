import { homedir } from "node:os";
import pc from "picocolors";
import { runKnowledgeStage } from "../../../core/knowledge/pipeline";
import { probeRoute } from "../../../core/knowledge/probe-route";
import {
  loadRouteCache as defaultLoadRouteCache,
  recordRoute as recordCacheRoute,
  type RouteCache,
  saveRouteCache as defaultSaveRouteCache,
} from "../../../core/knowledge/route-cache";
import { extractMetaClaims, type MetaClaim } from "../../../core/knowledge/route-meta";
import type { KnowledgeBlock } from "../../../core/knowledge/types";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";
import type { AgentBundle } from "../../../core/types";
import { cacheDirFor, type KnowledgePaths, knowledgeDirFor } from "../../../io/knowledge-paths";
import type { McpClientOpts } from "../../../io/mcp-client";
import { McpClientPool } from "../../../io/mcp-client-pool";
import {
  type AvailableMap,
  readAvailableMcpServers as defaultReadAvailable,
} from "../../../io/mcp-config-readers";
import { createSpawnOptsResolver } from "../../../io/mcp-spawn-resolver";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import { stateHome } from "../../../io/state-home";
import { defaultKnowledgePaths } from "../../install-paths";
import { findBundleOrFail, loadAllBundles, warnAllLoadFailures } from "../../load-all";

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

/**
 * Dependency-injection seams for `runKnowledgeCompile`. Production callers
 * omit these; tests pass `loadBundle` + `listAllBundles` to feed in-memory
 * fixtures without writing a registry file.
 *
 * `loadBundle(name)` resolves a single bundle by config name. Returns `null`
 * when the agent is not registered (so the CLI surfaces a `not-found`).
 *
 * `listAllBundles()` returns every loadable bundle. Used by `--all`. The
 * default reads `registry.json` and walks every catalog via the same
 * `loadAllBundles` pipeline that `agent install-all` uses.
 *
 * Routing seams (mirror `KnowledgeFetchDeps`): when a bundle declares
 * `via:` on a URL source the compile path now resolves it through an MCP
 * client pool — same wiring `smith agent install` and `smith knowledge
 * fetch` use. Tests inject `readAvailableMcpServers` / `loadRouteCache` /
 * `saveRouteCache` / `isTTY` to avoid touching the user's real `$HOME`
 * or `~/.config/agent-smith/url-routing.json`. `pool` is exposed so
 * tests can spy on `shutdown()` to assert the pool is torn down even on
 * error.
 */
export interface KnowledgeCompileDeps {
  paths?: KnowledgePaths;
  loadBundle?: (name: string) => Promise<AgentBundle | null>;
  listAllBundles?: () => Promise<AgentBundle[]>;
  /** Read available MCP servers (for via-routed sources). Tests inject to
   *  avoid touching the real `$HOME`. When provided, the live spawn-opts
   *  resolver is skipped — the resolver is built from the injected map. */
  readAvailableMcpServers?: () => Promise<AvailableMap>;
  /** DI seam for the per-user routing cache loader. Production omits and
   *  gets `loadRouteCache({ stateHome: stateHome() })`; tests inject a
   *  fake to avoid touching the real
   *  `~/.config/agent-smith/url-routing.json`. */
  loadRouteCache?: () => Promise<RouteCache>;
  /** Persist the per-user routing cache. Default writes to `stateHome()`.
   *  Tests inject a mock writer to assert the cache passed in without
   *  mutating `XDG_CONFIG_HOME`. */
  saveRouteCache?: (cache: RouteCache) => Promise<void>;
  /** TTY detector DI seam (defaults to `process.stdin.isTTY`). Tests pass
   *  `() => false` to assert the non-interactive path skips probing. */
  isTTY?: () => boolean;
  /** Pre-constructed pool. Tests inject to spy on `shutdown()`. Production
   *  omits and gets a fresh `McpClientPool` per command invocation. */
  pool?: McpClientPool;
}

export interface KnowledgeCompileOptions extends KnowledgeCompileDeps {
  name?: string;
  all?: boolean;
}

/**
 * `smith knowledge compile [name] [--all]`
 *
 * Forces a compile for one or every bundle that has a `knowledge` block with
 * at least one source, regardless of `compile.progressive` opt-in or v2.1
 * smart-default thresholds. Persists `compile-manifest.json` under the
 * agent's knowledge dir.
 *
 * Policy (v2.1-B):
 *   - The CLI is a *forced* compile. The user explicitly typed `smith
 *     knowledge compile <name>`; honor that.
 *   - The smart auto-compile default (in `runKnowledgeStage`) is for
 *     `smith agent install`'s implicit decisions — not this command.
 *   - We inject a `compile` block on the way into the pipeline so the
 *     existing compile branch fires deterministically. `tocMaxLines` and
 *     `emitAgentsMd` fall back to the bundle's own values where present.
 *
 * v1.4.4: routes via-declared URL sources through an MCP client pool the
 * same way `smith agent install` and `smith knowledge fetch` do. Without
 * this wiring the pipeline failed inside `acquire-source` with
 * "smith internal error" because the pool / spawn-opts resolver were
 * undefined.
 *
 * Exit codes follow agent-smith conventions:
 *   - 0  success (every targeted bundle with sources compiled cleanly)
 *   - 1  runtime error during compile
 *   - 2  usage error — bundle has no knowledge sources to compile
 *
 * `--all` skips bundles without any knowledge sources (with a warn line) and
 * only elevates to a non-zero exit code when EVERY bundle was skipped.
 */
export async function runKnowledgeCompile(
  opts: KnowledgeCompileOptions,
): Promise<number> {
  if (!opts.name && !opts.all) {
    throw new SmithError({
      code: "usage-error",
      message: "smith knowledge compile requires <name> or --all",
      suggestedCommand: "smith knowledge compile <name>",
    });
  }
  if (opts.name && opts.all) {
    throw new SmithError({
      code: "usage-error",
      message: "smith knowledge compile: pass <name> or --all, not both",
      suggestedCommand: "smith knowledge compile --all",
    });
  }

  const paths = opts.paths ?? defaultKnowledgePaths();
  const loadOne = opts.loadBundle ?? defaultLoadBundle;
  const listAll = opts.listAllBundles ?? defaultListAllBundles;

  const bundles: AgentBundle[] = opts.all
    ? await listAll()
    : await (async () => {
        const b = await loadOne(opts.name as string);
        if (!b) {
          throw new SmithError({
            code: "not-found",
            what: "agent",
            identifier: opts.name as string,
            suggestedCommand: `smith agent init ${opts.name}`,
          });
        }
        return [b];
      })();

  // Pool for via-routed URL sources. Lifetime = this command invocation,
  // shared across every bundle in the `--all` loop. Bundles without
  // via-routed sources never trigger an acquire-via path; the pool stays
  // empty for them. The `finally` block guarantees `pool.shutdown()`
  // runs even when a per-bundle compile throws.
  const pool = opts.pool ?? new McpClientPool();
  // Spawn-opts resolver mirrors install/fetch wiring. When tests inject
  // `readAvailableMcpServers`, build a resolver around the injected map
  // so via-routed sources still resolve; otherwise read from `$HOME`.
  const spawnOptsFor: (server: string) => McpClientOpts = opts.readAvailableMcpServers
    ? buildResolverFromMap(await opts.readAvailableMcpServers())
    : await createSpawnOptsResolver({ homeDir: homedir() });

  // Phase 3: per-user routing cache + _meta claims + probe callback +
  // record callback. Tests inject `loadRouteCache` to avoid touching the
  // user's real `~/.config/agent-smith/url-routing.json`.
  const loadRouteCacheFn =
    opts.loadRouteCache ?? (() => defaultLoadRouteCache({ stateHome: stateHome() }));
  let mutableRouteCache: RouteCache = await loadRouteCacheFn();

  // Layer 2 _meta self-claim collection. Gated behind SMITH_PROBE_META
  // because spawning every declared MCP server up front is expensive
  // (each can take 5-10s with auth handshakes); the probe-on-failure
  // path acquires servers lazily as needed.
  // Tests inject `readAvailableMcpServers` to skip the live `$HOME` read; we
  // also skip the eager probe in that case since the resolver would throw
  // for fixture server names not present in the synthetic map.
  const allMetaClaims: MetaClaim[] = [];
  if (process.env.SMITH_PROBE_META === "1" && opts.readAvailableMcpServers === undefined) {
    for (const b of bundles) {
      const declaredServers = b.config.mcpServers ?? [];
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
  }

  // probe-on-failure callback. Constructed only when stdin is a TTY so
  // non-interactive runs (cron, daemon, CI) never block on user input.
  const isTtyForProbe = opts.isTTY ? opts.isTTY() : Boolean(process.stdin.isTTY);
  const allBundleMcpServers = Array.from(
    new Set(bundles.flatMap((b) => b.config.mcpServers ?? [])),
  );
  const probeOnFailure = isTtyForProbe
    ? (url: string) =>
        probeRoute({
          url,
          bundleMcpServers: allBundleMcpServers,
          pool,
          spawnOptsFor,
          prompt: async (msg: string) => {
            process.stdout.write(msg);
            return new Promise<string>((resolve) => {
              process.stdin.once("data", (b) => resolve(b.toString().trim()));
            });
          },
          notify: (msg: string) => process.stdout.write(msg),
        })
    : undefined;

  // `persistRoute` honors the DI seam so tests can assert on the cache
  // passed in without mutating `$XDG_CONFIG_HOME` or hitting disk.
  const persistRoute =
    opts.saveRouteCache ??
    ((cache: RouteCache) => defaultSaveRouteCache({ stateHome: stateHome() }, cache));
  const recordRoute = async (r: { url: string; server: string; tool: string }) => {
    mutableRouteCache = recordCacheRoute(mutableRouteCache, {
      ...r,
      now: new Date().toISOString(),
    });
    await persistRoute(mutableRouteCache);
  };

  let exitCode = 0;
  let compiledCount = 0;
  let skippedCount = 0;

  try {
    for (const bundle of bundles) {
      const name = bundle.config.name;
      const block = bundle.config.knowledge;
      // The only real error: no knowledge sources to compile. A bundle with a
      // `knowledge` block but zero sources is just as actionable as no block at
      // all — both mean "nothing for compile() to consume".
      if (!block || !block.sources || block.sources.length === 0) {
        // --all path: skip with a one-line warn so a mixed catalog still works.
        // Single-name path: usage error.
        if (opts.all) {
          console.warn(pc.yellow(`skip ${name}: no knowledge sources to compile`));
          skippedCount += 1;
          continue;
        }
        console.error(
          `${name}: no knowledge sources to compile — add a "knowledge.sources" entry in agent.config.json.`,
        );
        return 2;
      }

      // Force compile regardless of opt-in / smart-default. The user explicitly
      // asked for it; pin progressive=true on the way in and let the pipeline's
      // existing compile branch run. Defaults mirror the schema/pipeline so the
      // emitted manifest matches what `smith agent install` would produce when
      // it auto-compiles.
      const forcedBlock: KnowledgeBlock = {
        ...block,
        compile: {
          progressive: true,
          tocMaxLines: block.compile?.tocMaxLines ?? 150,
          emitAgentsMd: block.compile?.emitAgentsMd ?? false,
        },
      };

      try {
        const result = await runKnowledgeStage(forcedBlock, {
          bundleDir: bundle.bundlePath,
          knowledgeDir: knowledgeDirFor(name, paths),
          cacheDir: cacheDirFor(name, paths),
        }, {
          mcpPool: pool,
          spawnOptsFor,
          routeCache: mutableRouteCache,
          metaClaims: allMetaClaims,
          ...(probeOnFailure ? { probeOnFailure } : {}),
          recordRoute,
        });
        if (result.errors.length > 0) {
          for (const e of result.errors) console.error(pc.red(`  error: ${e}`));
          exitCode = Math.max(exitCode, 1);
          continue;
        }
        if (!result.compiled) {
          console.error(
            pc.red(`${name}: compile produced no output (compile block ignored?)`),
          );
          exitCode = Math.max(exitCode, 1);
          continue;
        }
        const m = result.compiled.manifest;
        console.log(
          pc.green(
            `compiled ${name}: ${m.totals.sourcesShown} source(s), ${m.totals.tocLines} TOC line(s), hash ${m.contentHash.slice(0, 8)}`,
          ),
        );
        for (const w of result.warnings) console.warn(pc.yellow(`  warn: ${w}`));
        compiledCount += 1;
      } catch (err) {
        if (err instanceof SmithError) throw err;
        console.error(pc.red(`${name}: compile failed: ${toMessage(err)}`));
        exitCode = Math.max(exitCode, 1);
      }
    }

    if (opts.all && compiledCount === 0) {
      // Every targeted bundle was skipped — surface a usage hint so the user
      // knows --all matched nothing actionable.
      if (skippedCount > 0) {
        console.error(
          `no registered bundles had knowledge sources to compile; ` +
            `add a "knowledge.sources" entry to at least one agent.config.json.`,
        );
        return 2;
      }
      console.log(pc.dim("no agents registered"));
    }

    return exitCode;
  } finally {
    // Pool lifetime ends here so via-routed acquires can finish before we
    // tear down their connections. shutdown() is idempotent and safe even
    // when nothing was acquired.
    await pool.shutdown();
  }
}

/**
 * Default `loadBundle`: walks the registry and matches by config name. Mirrors
 * the resolution path used by `smith agent install <name>` so behaviour stays
 * in lockstep — same registry, same catalog walk, same load-failure surface.
 */
async function defaultLoadBundle(name: string): Promise<AgentBundle | null> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const all = await loadAllBundles(reg);
  warnAllLoadFailures(all.failures, (m) => console.error(m));
  try {
    return findBundleOrFail(all, name);
  } catch (err) {
    if (err instanceof SmithError && err.payload.code === "not-found") return null;
    throw err;
  }
}

/**
 * Default `listAllBundles`: every loadable bundle in the registry, mirroring
 * `installAll()` (src/cli/commands/install-all.ts). Load failures are warned
 * to stderr but do not abort the run — `--all` is best-effort across catalogs.
 */
async function defaultListAllBundles(): Promise<AgentBundle[]> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const all = await loadAllBundles(reg);
  warnAllLoadFailures(all.failures, (m) => console.error(m));
  return all.bundles;
}
