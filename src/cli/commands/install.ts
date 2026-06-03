import { homedir } from "node:os";
import pc from "picocolors";
import { probeRoute } from "../../core/knowledge/probe-route";
import { type PlatformId, writeRefreshManifest } from "../../core/knowledge/refresh-manifest";
import { parseRefresh } from "../../core/knowledge/refresh-spec";
import {
  loadRouteCache as defaultLoadRouteCache,
  recordRoute as recordCacheRoute,
  type RouteCache,
  saveRouteCache as defaultSaveRouteCache,
} from "../../core/knowledge/route-cache";
import { extractMetaClaims, type MetaClaim } from "../../core/knowledge/route-meta";
import { SmithError } from "../../core/smith-error";
import type { AgentBundle, CanonicalConfig, InstallPaths, Target } from "../../core/types";
import { registerAgentInCodexHooks } from "../../io/codex-hooks";
import {
  type InstallRequiredSkillsMode,
  installRequiredSkills,
} from "../../io/install-required-skills";
import { loadInstalledSkills } from "../../io/installed-skills";
import {
  type AvailableMap,
  readAvailableMcpServers as defaultReadAvailable,
} from "../../io/mcp-config-readers";
import { McpClientPool } from "../../io/mcp-client-pool";
import { createSpawnOptsResolver } from "../../io/mcp-spawn-resolver";
import { registerAgentInOpencodePlugin } from "../../io/opencode-plugin";
import {
  type BuildAndInstallOptions,
  buildAndInstall,
  type OrchestratorResult,
} from "../../io/orchestrator";
import type { Registry } from "../../io/registry";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { installSkill } from "../../io/skill-installer";
import { stateHome } from "../../io/state-home";
import { formatInstallSummary } from "../format-install";
import { formatKnowledgeLines } from "../format";
import {
  defaultAgentSmithHome,
  defaultCodexHome,
  defaultInstallPaths,
  defaultOpencodeConfigHome,
} from "../install-paths";
import {
  findBundleOrFail,
  type LoadAllBundlesResult,
  loadAllBundles,
  warnUnrelatedLoadFailures,
} from "../load-all";
import { readConsentChoice, readToken } from "../prompt";
import type { RefreshConsentParsed } from "../parse-refresh-consent";
import { preflightMcp } from "./agent/preflight-mcp";

/**
 * Default adapter for the installed-skills file: returns just the
 * names list. Used when callers don't inject their own loader.
 */
async function defaultLoadInstalledSkillNames(): Promise<string[]> {
  const file = await loadInstalledSkills();
  return file.installed.map((e) => e.name);
}

/**
 * Build a `spawnOptsFor` resolver around a pre-fetched `AvailableMap`. Used
 * when tests inject `readAvailableMcpServers` so via-routed sources and
 * the Phase 3 probe callback still resolve through the test's stubbed
 * map (instead of touching real `$HOME`). Mirrors
 * `createSpawnOptsResolver` but skips the homedir read.
 */
function buildResolverFromMap(
  map: AvailableMap,
): (name: string) => import("../../io/mcp-client").McpClientOpts {
  return (name: string) => {
    const entry = map[name];
    if (!entry) {
      throw new SmithError({
        code: "validation-failed",
        what: `mcp server '${name}'`,
        reasons: [
          `'${name}' is not configured in any platform MCP config`,
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
 * Default adapter that translates a `<catalog>/<name>` or `<name>` ref into
 * an `installSkill()` call. Throws on failure (non-`ok` result), so
 * the orchestrator can degrade it to a warning rather than abort install.
 */
async function defaultInstallSkillByRef(ref: string): Promise<void> {
  const slash = ref.indexOf("/");
  const name = slash === -1 ? ref : ref.slice(slash + 1);
  const catalog = slash === -1 ? undefined : ref.slice(0, slash);
  const result = await installSkill(name, catalog ? { catalog } : {});
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export interface InstallCliOptions {
  /** Agent name. Optional when `from` is set and the remote has exactly one
   *  bundle; required otherwise. */
  name?: string;
  /** External git URL to clone before installing (C3.9). Triggers the
   *  remote-install branch via installFromUrl(); the cloned catalog is
   *  registered in registry.json before the normal install flow runs. */
  from?: string;
  /** Git ref to clone when `from` is set. Defaults to `HEAD`. */
  ref?: string;
  /** Install every agent discovered in --from <url>. */
  all?: boolean;
  /** Comma-separated agents to install from --from <url>. */
  agents?: string;
  /** Discover agents from --from <url>, print JSON, do not install. */
  json?: boolean;
  paths?: InstallPaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  buildAndInstall?: (
    bundles: AgentBundle[],
    paths: InstallPaths,
    options?: BuildAndInstallOptions,
  ) => Promise<OrchestratorResult>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  /** How to handle missing required skills; default "prompt". */
  skillMode?: InstallRequiredSkillsMode;
  /** Loader DI seam (defaults to reading installed-skills.json). */
  loadInstalledSkillNames?: () => Promise<string[]>;
  /** Installer DI seam (defaults to installSkill via skill-installer). */
  installSkillByRef?: (ref: string) => Promise<void>;
  /** Prompt DI seam (defaults to readToken). */
  prompt?: (msg: string) => Promise<string>;
  /** TTY detector DI seam (defaults to process.stdin.isTTY). */
  isTTY?: () => boolean;
  /** Pre-answer the refresh consent prompt for CI use. When undefined and
   *  the agent has session/always sources, the prompt runs. */
  refreshConsent?: RefreshConsentParsed;
  /** Skip hook installation entirely. No prompt, no manifest, no hooks. */
  noRefreshHooks?: boolean;
  /** Override default agent-smith home for tests. */
  agentSmithHome?: string;
  /** Override default ~/.codex dir for tests. */
  codexHome?: string;
  /** Override default ~/.config/opencode dir for tests. */
  opencodeConfigHome?: string;
  /** When set, restricts installation to the intersection of this list and
   *  the agent's declared targets. Throws `usage-error` if the intersection
   *  is empty. Default: install to all declared targets. */
  platformFilter?: PlatformId[];
  /**
   * v1-task B7 opt-out. When true, missing MCP servers in
   * `config.mcpServers` are demoted from install-blocking errors back to
   * warnings. Default (undefined/false) blocks install with a remediation
   * hint. CLI flag: `--allow-missing-mcp`.
   */
  allowMissingMcp?: boolean;
  /** Forward to the CLI's `--allow-missing-cli` flag. */
  allowMissingCli?: boolean;
  /**
   * Bypass the would-clobber refusal when a non-smith file occupies the
   * destination, OR re-claim a manifest entry whose recorded path no longer
   * matches the new render's relativePath (rename / translator change).
   * CLI flag: `--force`. Threaded into BuildAndInstallOptions.force →
   * installRendered.
   */
  force?: boolean;
  /**
   * Surface info-level translator warnings (pattern-based fallback,
   * platform truisms, etc.) in the install output. Default false hides
   * them so the output stays focused on actionable items.
   * CLI flag: `--verbose`.
   */
  verbose?: boolean;
  /**
   * PlatformConventions resolution strategy (Task 3.5).
   * - accept-all   → emit all registered conventions for every target
   * - reject-all   → emit none (also: --no-platform-conventions)
   * - use-defaults → emit only conventions with promptDefault: true
   * - prompt       → defer to TTY prompt; non-TTY falls through to
   *                  fail-safe-reject inside resolveConventions
   *
   * Threaded into BuildAndInstallOptions.platformConventions → orchestrator
   * → resolveConventions for each declared target.
   */
  platformConventions?: import("../../io/conventions").DefaultStrategy;
  /**
   * DI seam for the MCP-config preflight reader. Production omits and gets
   * a reader pointed at the user's real `$HOME`; tests inject a synthetic
   * `AvailableMap` to exercise the preflight branches without touching disk.
   */
  readAvailableMcpServers?: () => Promise<AvailableMap>;
  /**
   * Phase 3 DI seam for the per-user routing cache loader. Production omits
   * and gets `loadRouteCache({ stateHome: stateHome() })`; tests inject a
   * function that returns a synthetic `RouteCache` so a cached route can
   * short-circuit HTTP without touching the user's real
   * `~/.config/agent-smith/url-routing.json`.
   */
  loadRouteCache?: () => Promise<RouteCache>;
  /**
   * v1.4.2 DI: persist the per-user routing cache. Default writes to
   * `stateHome()`. Tests inject a mock writer to assert the cache passed
   * in without mutating `XDG_CONFIG_HOME` or touching the user's real
   * `~/.config/agent-smith/url-routing.json`.
   */
  saveRouteCache?: (cache: RouteCache) => Promise<void>;
}

export interface InstallBareHelpfulErrorOptions {
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
}

/**
 * Throws a `usage-error` SmithError shaped for the user's actual situation:
 * if any agents are registered, lists them and points to `agent install <name>`
 * or `agent install-all`; if none exist, points to `agent init`. Replaces
 * commander's bare `missing required argument` for `smith agent install`.
 */
export async function installBareHelpfulError(
  opts: InstallBareHelpfulErrorOptions = {},
): Promise<never> {
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const reg = await loadReg(canonicalRegistryPath());
  const loadResult = await loadBundles(reg);
  const names = loadResult.bundles.map((b) => b.config.name).sort();

  if (names.length === 0) {
    throw new SmithError({
      code: "usage-error",
      message:
        "missing agent name (no agents are currently registered)\n\n" +
        '  Create one:    smith agent init <name> --description "..."\n' +
        "  Or via wizard: opencode --agent agent-smith",
      suggestedCommand: 'smith agent init <name> --description "..."',
    });
  }

  const list = names.map((n) => `    ${n}`).join("\n");
  // When exactly one agent exists, suggest installing it directly. The
  // "install-all" hint is louder than helpful in single-agent setups
  // (most fresh installs land here with just `agent-smith` registered).
  const suggestedCommand =
    names.length === 1
      ? `smith agent install ${names[0]}`
      : "smith agent install-all";
  throw new SmithError({
    code: "usage-error",
    message:
      `missing agent name\n\n` +
      `  Available agents:\n${list}\n\n` +
      `  To install one:    smith agent install <name>\n` +
      `  To install all:    smith agent install-all`,
    suggestedCommand,
  });
}

export async function install(opts: InstallCliOptions | string): Promise<number> {
  // Back-compat: a positional string is treated as { name }. The CLI entry
  // point in src/index.ts still calls install(name).
  const o: InstallCliOptions = typeof opts === "string" ? { name: opts } : opts;
  const paths = o.paths ?? defaultInstallPaths();
  const loadReg = o.loadRegistry ?? loadRegistry;
  const loadBundles = o.loadAllBundles ?? loadAllBundles;
  const build = o.buildAndInstall ?? buildAndInstall;
  const print = o.print ?? ((m: string) => console.log(m));
  const printErr = o.printErr ?? ((m: string) => console.error(m));

  // v1-task C3.9: --from <url> branch. Clone + register before continuing
  // into the normal install pipeline. If no name is given and the remote
  // contains exactly one bundle, infer it; otherwise emit a disambiguation
  // hint and exit non-zero.
  if (o.from) {
    const { isLikelyGitUrl } = await import("../../io/remote-path");
    if (!isLikelyGitUrl(o.from)) {
      printErr(`smith: --from is not a recognized git url: ${o.from}`);
      return 2;
    }
    const { discoverFromUrl, installFromUrl } = await import("../../core/install-from-url");
    let disco: Awaited<ReturnType<typeof discoverFromUrl>>;
    try {
      disco = await discoverFromUrl({
        kind: "agent",
        url: o.from,
        ...(o.ref ? { ref: o.ref } : {}),
      });
    } catch (err) {
      printErr(
        `smith: failed to install from ${o.from}: ${(err as Error).message}`,
      );
      return 2;
    }

    // --json: print discovery and exit without registering or installing.
    if (o.json) {
      print(JSON.stringify({ kind: "agent", ...disco }, null, 2));
      return 0;
    }

    // Resolve which agents to install.
    const isTty = o.isTTY ? o.isTTY() : Boolean(process.stdin.isTTY);
    const read = o.prompt ? () => o.prompt!("> ") : (): Promise<string> => import("../prompt").then((m) => m.readToken("> "));
    const names = await resolveAgentSelection(disco.bundles, {
      ...(o.name ? { name: o.name } : {}),
      ...(o.agents ? { agents: o.agents } : {}),
      all: Boolean(o.all),
      isTty,
      read,
      from: o.from,
      printErr,
    });
    // Non-TTY disambiguation: returns null to signal "return 2".
    if (names === null) {
      return 2;
    }

    // Register the catalog via installFromUrl.
    try {
      await installFromUrl({
        kind: "agent",
        url: o.from,
        ...(o.ref ? { ref: o.ref } : {}),
      });
    } catch (err) {
      printErr(
        `smith: failed to install from ${o.from}: ${(err as Error).message}`,
      );
      return 2;
    }

    // Install each selected agent, intersecting platforms.
    const chosen = o.platformFilter ?? undefined;
    let failed = 0;
    let installed = 0;
    for (const n of names) {
      const declared = disco.bundles.find((b) => b.name === n)?.targets ?? [];
      const inter: PlatformId[] = chosen
        ? (declared.filter((t) => chosen.includes(t as PlatformId)) as PlatformId[])
        : (declared as PlatformId[]);
      if (chosen && inter.length === 0) {
        printErr(`⚠ skipping ${n}: no selected platform matches its declared targets (${declared.join(", ")})`);
        continue;
      }
      const code = await install({
        name: n,
        platformFilter: inter,
        paths,
        ...(o.noRefreshHooks ? { noRefreshHooks: true } : {}),
        ...(o.loadRegistry ? { loadRegistry: o.loadRegistry } : {}),
        ...(o.loadAllBundles ? { loadAllBundles: o.loadAllBundles } : {}),
        ...(o.buildAndInstall ? { buildAndInstall: o.buildAndInstall } : {}),
        ...(o.force ? { force: true } : {}),
        ...(o.verbose ? { verbose: true } : {}),
        ...(o.allowMissingMcp ? { allowMissingMcp: true } : {}),
        ...(o.allowMissingCli ? { allowMissingCli: true } : {}),
        ...(o.platformConventions ? { platformConventions: o.platformConventions } : {}),
        print,
        printErr,
        ...(o.skillMode ? { skillMode: o.skillMode } : {}),
        ...(o.refreshConsent ? { refreshConsent: o.refreshConsent } : {}),
        ...(o.agentSmithHome ? { agentSmithHome: o.agentSmithHome } : {}),
        ...(o.codexHome ? { codexHome: o.codexHome } : {}),
        ...(o.opencodeConfigHome ? { opencodeConfigHome: o.opencodeConfigHome } : {}),
        ...(o.forceUnlock ? { forceUnlock: true } : {}),
      });
      if (code !== 0) failed++;
      else installed++;
    }
    if (failed > 0) return 1;
    if (names.length > 0 && installed === 0) {
      printErr("smith: no agents were installed (all skipped — no selected platform matched their declared targets)");
      return 1;
    }
    return 0;
  }

  if (!o.name) {
    await installBareHelpfulError({
      ...(o.loadRegistry ? { loadRegistry: o.loadRegistry } : {}),
      ...(o.loadAllBundles ? { loadAllBundles: o.loadAllBundles } : {}),
    });
    return 2;
  }
  const name = o.name;

  // --force-unlock: drop a stale per-agent install lock before any acquire
  // attempt downstream (orchestrator's acquireInstallLock). Recovery path
  // for runs killed mid-flight (Ctrl-C, parent process died) that left a
  // 0-byte `.install.lock` behind. The 60-min staleness threshold otherwise
  // blocks every retry until it expires. The lock path is resolved from the
  // same `agentSmithHome` the orchestrator's lock acquire uses, so the
  // remove targets the same file the orchestrator would re-create.
  if (o.forceUnlock) {
    const home = o.agentSmithHome ?? defaultAgentSmithHome();
    const lockPath = installLockPath(home, name);
    try {
      const st = await stat(lockPath);
      printErr(
        `${pc.yellow("warn")} forcing release of install lock at ${lockPath} (held since ${st.mtime.toISOString()})`,
      );
      await rm(lockPath, { force: true });
    } catch (err) {
      // ENOENT = no lock to release; silent. Anything else (EACCES, EROFS)
      // is surfaced because the user explicitly asked us to act on the lock.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  const reg = await loadReg(canonicalRegistryPath());
  const loadResult = await loadBundles(reg);

  // Surface unrelated load failures as warnings before lookup. If
  // findBundleOrFail throws not-found, no later code runs — so we'd
  // silently lose these failures. The basename check avoids double-
  // reporting the target failure (findBundleOrFail re-surfaces it as
  // a partial-failure SmithError below).
  warnUnrelatedLoadFailures(loadResult.failures, name, printErr);

  // Throws partial-failure if the target was in failures (basename match),
  // or not-found if neither bundles nor failures match.
  const bundle = findBundleOrFail(loadResult, name);
  // --platforms filter (CLI option). Clone rather than mutate so callers
  // that retain a reference to the loaded bundle (e.g. a future caller
  // that caches load results) see unfiltered targets.
  const filteredBundle = applyPlatformFilter(bundle, o.platformFilter);
  const bundles = [filteredBundle];

  // Preflight MCP dependencies BEFORE the consent loop so the user doesn't
  // answer prompts for an install that's about to refuse. `mcp.required[]`
  // missing aborts (EXIT_RUNTIME=1); `mcp.peer[]` missing only warns.
  // `--allow-missing-mcp` demotes required-missing to a warning, mirroring
  // the existing escape hatch for legacy `mcpServers[]`.
  const readAvailable =
    o.readAvailableMcpServers ?? (() => defaultReadAvailable({ homeDir: homedir() }));
  const available = await readAvailable();
  for (const b of bundles) {
    const preflight = preflightMcp(b.config.mcp ?? {}, available);
    if (preflight.requiredMissing.length > 0) {
      if (o.allowMissingMcp) {
        printErr(
          `smith: ${b.config.name} required MCP server(s) missing but allowed by --allow-missing-mcp: ${preflight.requiredMissing.join(", ")}`,
        );
      } else {
        printErr(
          `smith: ${b.config.name} required MCP server(s) not installed: ${preflight.requiredMissing.join(", ")}`,
        );
        printErr(`       Install them and re-run, or pass --allow-missing-mcp.`);
        return 1;
      }
    }
    if (preflight.peerMissing.length > 0) {
      printErr(
        `smith: ${b.config.name} expects MCP server(s) (peer; not strictly required): ${preflight.peerMissing.join(", ")}`,
      );
    }
  }

  // Pool lifetime equals one install invocation. via-routed knowledge
  // sources fetch through `pool` (forwarded into `acquireSource` via the
  // orchestrator); bundles without via-routed sources never trigger an
  // acquire, so the pool stays empty for them. The `finally` block
  // guarantees `pool.shutdown()` runs even when build/install throws.
  const pool = new McpClientPool();
  // Spawn-opts resolver mirrors the available-map: built once per install
  // off the same `$HOME` so via-routed sources resolve consistently with
  // the preflight check. When tests inject `readAvailableMcpServers`,
  // build the resolver around the injected map so via-routed sources and
  // the Phase 3 probe callback still resolve through the test's stubbed
  // map (not real `$HOME`).
  const spawnOptsFor: (server: string) => import("../../io/mcp-client").McpClientOpts =
    o.readAvailableMcpServers
      ? buildResolverFromMap(available)
      : await createSpawnOptsResolver({ homeDir: homedir() });

  // Phase 3: per-user routing cache + _meta claims + probe callback +
  // record callback. Loaded once per install, threaded through the build
  // → orchestrator → pipeline → `acquireSource` chain so URL sources
  // without explicit `via:` resolve through the three-layer resolver.
  // Tests inject `loadRouteCache` to avoid touching the user's real
  // `~/.config/agent-smith/url-routing.json`.
  const loadRouteCacheFn =
    o.loadRouteCache ?? (() => defaultLoadRouteCache({ stateHome: stateHome() }));
  let mutableRouteCache: RouteCache = await loadRouteCacheFn();

  // Layer 2 _meta self-claim collection. Gated behind SMITH_PROBE_META
  // because spawning every declared MCP server up front is expensive
  // (each can take 5-10s with auth handshakes); the probe-on-failure
  // path acquires servers lazily as needed.
  // Tests inject `readAvailableMcpServers` to skip the live $HOME read; we
  // also skip the eager probe in that case since the resolver would throw
  // for fixture server names not present in the synthetic map.
  const allMetaClaims: MetaClaim[] = [];
  if (process.env.SMITH_PROBE_META === "1" && !o.readAvailableMcpServers) {
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
  // The closure captures the pool, spawn-opts resolver, and a stdin-reading
  // prompt that returns the trimmed first line.
  const isTtyForProbe = o.isTTY ? o.isTTY() : Boolean(process.stdin.isTTY);
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

  // Record callback: persist a confirmed probe result back to the cache so
  // subsequent installs skip the prompt. Updates the in-memory cache view
  // and re-saves on every record. Race with concurrent installs is
  // benign — last-writer-wins with idempotent recordCacheRoute upserts.
  // `persistRoute` honors the DI seam so tests can assert on the cache
  // passed in without mutating $XDG_CONFIG_HOME or hitting disk.
  const persistRoute =
    o.saveRouteCache ??
    ((cache: RouteCache) => defaultSaveRouteCache({ stateHome: stateHome() }, cache));
  const recordRoute = async (r: { url: string; server: string; tool: string }) => {
    mutableRouteCache = recordCacheRoute(mutableRouteCache, {
      ...r,
      now: new Date().toISOString(),
    });
    await persistRoute(mutableRouteCache);
  };

  try {
  // Refresh-hook consent (spec §5.2 + §5.4). MUST run BEFORE buildAndInstall:
  // the translator gates emission of the SessionStart hook block on an
  // explicit opt-in flag threaded through the render context, so we have to
  // know the per-bundle decision before files are written. Previously this
  // ran AFTER buildAndInstall, which produced "orphan hooks": files with
  // SessionStart blocks but no refresh manifest, firing on every Claude
  // session even when the user passed `--no-refresh-hooks` or declined.
  //
  // We re-derive the set of session/always sources from the canonical config
  // rather than peeking into rendered frontmatter, keeping schema as the
  // source of truth.
  const promptFn = o.prompt ?? readToken;
  const withRefreshHooksFor = new Map<string, boolean>();
  // Per-bundle map of platforms the user consented to. Populated in the
  // pre-render pass; consumed in the post-install pass to write the
  // refresh manifest and (for codex) register the hook entry.
  const consentedBundles: {
    bundle: AgentBundle;
    sources: string[];
    platforms: PlatformId[];
  }[] = [];
  // Platforms eligible for the refresh-hook consent flow.
  const CONSENT_PLATFORMS: PlatformId[] = ["claude-code", "codex", "opencode"];
  if (!o.noRefreshHooks) {
    // Pre-derive the set of session/always sources per bundle (same shape
    // across platforms, so we compute once).
    const eligibleBundles = bundles
      .map((b) => {
        const sessionSources = (b.config.knowledge?.sources ?? [])
          .filter((s) => {
            const n = parseRefresh(s.refresh);
            return n.mode === "session" || n.mode === "always";
          })
          .map((s) => s.id);
        return { bundle: b, sessionSources };
      })
      .filter((x) => x.sessionSources.length > 0);

    for (const { bundle: b, sessionSources } of eligibleBundles) {
      const targets = b.config.targets.filter((t): t is PlatformId =>
        CONSENT_PLATFORMS.includes(t as PlatformId),
      );
      if (targets.length === 0) continue;

      const isTty = o.isTTY ? o.isTTY() : o.prompt !== undefined || Boolean(process.stdin.isTTY);

      const consentingPlatforms: PlatformId[] = [];
      const skipMsg = (target: PlatformId) =>
        `${pc.yellow("warn")} refresh-hook consent skipped for ${b.config.name} on ${target} (non-interactive). Re-run with --refresh-consent yes to enable.`;
      for (const target of targets) {
        // Resolve any pre-answered consent (CLI flag) for this specific
        // target. Scalar applies uniformly; perPlatform may omit a target
        // (in which case we fall through to the prompt/non-TTY flow).
        let preAnswered: "yes" | "no" | undefined;
        if (o.refreshConsent?.kind === "scalar") {
          preAnswered = o.refreshConsent.value;
        } else if (o.refreshConsent?.kind === "perPlatform") {
          preAnswered = o.refreshConsent.value[target];
        }

        let decision: "yes" | "no";
        if (preAnswered !== undefined) {
          decision = preAnswered;
        } else if (!isTty) {
          // Non-TTY default: skip hook install (spec §5.4). Tell the user
          // how to opt in explicitly. Stderr because this is operational
          // guidance, not part of the install summary.
          printErr(skipMsg(target));
          decision = "no";
        } else {
          printConsentPrompt(b.config, target, printErr);
          const first = await readConsentChoice({
            read: async () => promptFn("> "),
          });
          if (first === "details") {
            printConsentDetails(b.config, target, printErr);
            // Cap at one expansion: a follow-up "details" is treated as yes
            // (the default) to avoid an infinite re-print loop.
            const second = await readConsentChoice({
              read: async () => promptFn("Allow? [Y/n] "),
            });
            decision = second === "no" ? "no" : "yes";
          } else {
            decision = first;
          }
        }
        if (decision !== "yes") continue;

        // claude-code requires the pre-render gate because its translator
        // emits the hook frontmatter at render time. codex does not — its
        // hook lives in ~/.codex/hooks.json which we touch post-install.
        if (target === "claude-code") {
          withRefreshHooksFor.set(b.config.name, true);
        }
        consentingPlatforms.push(target);
      }

      if (consentingPlatforms.length > 0) {
        consentedBundles.push({
          bundle: b,
          sources: sessionSources,
          platforms: consentingPlatforms,
        });
      }
    }
  }

  // Build agent bundles. If any agent build fails we abort before
  // touching the user's skill set — installing a required skill for an
  // agent that didn't ship would leave a confusing partial state.
  // `mcpPool` + `spawnOptsFor` thread to `acquireSource` for via-routed
  // knowledge sources. `routeCache` + `metaClaims` + `probeOnFailure` +
  // `recordRoute` thread the Phase 3 three-layer resolver through the
  // pipeline so URL sources without explicit `via:` get cached/advertised
  // routing and can prompt to probe declared servers on direct-fetch
  // failure.
  const result = await build(bundles, paths, {
    withRefreshHooksFor,
    ...(o.allowMissingMcp ? { allowMissingMcp: true } : {}),
    ...(o.allowMissingCli ? { allowMissingCli: true } : {}),
    ...(o.force === true ? { force: true } : {}),
    ...(o.platformConventions
      ? { platformConventions: o.platformConventions }
      : {}),
    mcpPool: pool,
    spawnOptsFor,
    routeCache: mutableRouteCache,
    metaClaims: allMetaClaims,
    ...(probeOnFailure ? { probeOnFailure } : {}),
    recordRoute,
  });
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      printErr(pc.red(`FAIL ${e.agent}`));
      for (const m of e.messages) printErr(pc.red(`  ${m}`));
    }
    return 1;
  }

  // Print build output first so the user sees agent-install results
  // before the (separate) required-skills section. The formatter groups
  // by agent + status glyph + per-target detail; see src/cli/format-install.ts.
  const summaryLines = formatInstallSummary(
    {
      installed: result.installed,
      skipped: result.skipped,
      warnings: result.warnings,
    },
    {
      verbose: o.verbose === true,
      style: pc as unknown as import("../format-install").InstallSummaryStyler,
    },
  );
  for (const line of summaryLines) print(line);

  // Knowledge materialization summary. One block per agent that has any
  // knowledge sources. formatKnowledgeLines returns an empty array for
  // agents whose sources list is empty, which suppresses display naturally.
  for (const summary of result.knowledge) {
    for (const line of formatKnowledgeLines(summary)) {
      print(line);
    }
  }

  // Required-skills resolution (spec §8.3). Runs after a successful build.
  // Per spec, never aborts on skill failure — surfaces warnings so the user
  // sees the agent install attempt complete.
  const skillMode: InstallRequiredSkillsMode = o.skillMode ?? "prompt";
  const loadInstalled = o.loadInstalledSkillNames ?? defaultLoadInstalledSkillNames;
  const installSkillRef = o.installSkillByRef ?? defaultInstallSkillByRef;
  for (const bundle of bundles) {
    const required = bundle.config.requires?.skills ?? [];
    if (required.length === 0) continue;
    const skillResult = await installRequiredSkills({
      agentName: bundle.config.name,
      required,
      mode: skillMode,
      loadInstalledSkillNames: loadInstalled,
      installSkillByRef: installSkillRef,
      prompt: promptFn,
      ...(o.isTTY ? { isTTY: o.isTTY } : {}),
    });
    for (const ref of skillResult.installed) {
      print(`${pc.green("→")} skill ${ref} installed`);
    }
    for (const w of skillResult.warnings) {
      print(`${pc.yellow("warn")} ${w}`);
    }
  }

  // Refresh-hook consent — post-install side effects. Consent prompts ran
  // BEFORE build (see top of this function) so the render layer received
  // correct gating. Here we persist the manifest for bundles the user
  // approved and, for codex-consenting bundles, register the agent in
  // ~/.codex/hooks.json. Doing this AFTER successful install keeps the
  // invariant that no manifest / hook entry is written for a bundle whose
  // render failed.
  if (consentedBundles.length > 0) {
    const home = o.agentSmithHome ?? defaultAgentSmithHome();
    const codexHome = o.codexHome ?? defaultCodexHome();
    const opencodeHome = o.opencodeConfigHome ?? defaultOpencodeConfigHome();
    for (const { bundle: b, sources, platforms } of consentedBundles) {
      if (platforms.includes("codex")) {
        await registerAgentInCodexHooks(codexHome, b.config.name);
        // One-time advisory: codex requires the user to run /hooks the
        // first time the hooks.json sentinel changes, otherwise the
        // SessionStart entry is silently ignored.
        printErr(
          `smith: open codex and type /hooks to trust the smith entry for ${b.config.name}.`,
        );
      }
      if (platforms.includes("opencode")) {
        // Register the agent in the shared agent-smith-refresh OpenCode
        // plugin. Plugin dir + opencode.json entry are created on first
        // call; subsequent agents are appended to the sentinel.
        await registerAgentInOpencodePlugin(opencodeHome, b.config.name);
        // Symmetric acknowledgment with the codex /hooks advisory above.
        // Opencode plugins load automatically on the next session.created
        // event, so no manual reload step is required — just confirm.
        printErr(`smith: registered ${b.config.name} in the agent-smith-refresh OpenCode plugin.`);
      }
      await writeRefreshManifest(home, b.config.name, {
        schemaVersion: 1,
        agent: b.config.name,
        refresh_consent: {
          granted_at: new Date().toISOString(),
          platforms,
          sources,
        },
      });
    }
  }

  return 0;
  } finally {
    // Pool lifetime ends here so via-routed acquires can run during build
    // and finish before we tear down their connections. shutdown() is
    // idempotent and safe even when nothing was acquired.
    await pool.shutdown();
  }
}

/**
 * Resolve which agents to install from a multi-agent remote.
 * Returns null when non-TTY disambiguation is needed (caller prints + returns 2).
 * Single-bundle remotes auto-select. --all / --agents / name positional resolve directly.
 */
async function resolveAgentSelection(
  bundles: Array<{ name: string; description: string; targets?: string[]; alreadyInstalled: boolean }>,
  o: { name?: string; agents?: string; all: boolean; isTty: boolean; read: () => Promise<string>; from: string; printErr: (m: string) => void },
): Promise<string[] | null> {
  const { promptMultiSelect } = await import("../multi-select");
  const valid = new Set(bundles.map((b) => b.name));
  const fail = (n: string) =>
    new SmithError({ code: "usage-error", message: `unknown agent '${n}' (valid: ${[...valid].join(", ")})` });
  if (o.name) { if (!valid.has(o.name)) throw fail(o.name); return [o.name]; }
  if (o.agents) {
    const list = o.agents.split(",").map((s) => s.trim()).filter(Boolean);
    for (const a of list) if (!valid.has(a)) throw fail(a);
    return list;
  }
  if (o.all) return bundles.map((b) => b.name);
  if (bundles.length === 1) return [bundles[0]!.name];
  if (o.isTty) {
    const idx = await promptMultiSelect(
      bundles.map((b) => ({ label: b.name, hint: b.description.slice(0, 80), ...(b.alreadyInstalled ? { annotation: "[installed]" } : {}) })),
      { read: o.read },
    );
    return idx.map((i) => bundles[i]!.name);
  }
  o.printErr(
    `smith: ${o.from} contains ${bundles.length} agents: ${bundles.map((b) => b.name).join(", ")}. Specify which: pass <name>, --agents <names>, or --all.`,
  );
  return null;
}

/**
 * Restrict a bundle's `config.targets` to the intersection with `filter`.
 * Returns the original bundle when `filter` is undefined or empty.
 * Throws `usage-error` SmithError when the intersection is empty so the
 * caller fails fast instead of silently installing nothing.
 *
 * Order is preserved from the bundle's declared targets (not the filter),
 * to keep per-agent install order stable across invocations.
 */
function applyPlatformFilter(
  bundle: AgentBundle,
  filter: PlatformId[] | undefined,
): AgentBundle {
  if (!filter || filter.length === 0) return bundle;
  const declared: Target[] = bundle.config.targets;
  // PlatformId and Target are structurally identical unions today; widen
  // for the membership check so we don't pretend the filter values are
  // already narrowed to Target.
  const filterAsStrings: readonly string[] = filter;
  const kept = declared.filter((t) => filterAsStrings.includes(t));
  if (kept.length === 0) {
    throw new SmithError({
      code: "usage-error",
      message:
        `agent '${bundle.config.name}' has no targets matching --platforms ${filter.join(",")} ` +
        `(declared: ${declared.length === 0 ? "none" : declared.join(", ")})`,
    });
  }
  return {
    ...bundle,
    config: { ...bundle.config, targets: kept },
  };
}

function printConsentPrompt(
  config: CanonicalConfig,
  platform: PlatformId,
  printErr: (msg: string) => void,
): void {
  const sources = (config.knowledge?.sources ?? []).filter((s) => {
    const n = parseRefresh(s.refresh);
    return n.mode === "session" || n.mode === "always";
  });
  printErr("");
  printErr(`This agent declares ${sources.length} source(s) that refresh at session start:`);
  for (const s of sources) {
    const n = parseRefresh(s.refresh);
    printErr(`  - ${s.id} (${s.type}, ${n.mode})`);
  }
  printErr("");
  if (platform === "codex") {
    printErr("To enable auto-refresh on codex, smith will add a SessionStart entry");
    printErr("to ~/.codex/hooks.json (smith-managed).");
  } else if (platform === "opencode") {
    printErr("To enable auto-refresh on opencode, smith will install (or update)");
    printErr("the shared agent-smith-refresh plugin at");
    printErr("~/.config/opencode/plugins/agent-smith-refresh/ and register");
    printErr("it in ~/.config/opencode/opencode.json.");
  } else {
    printErr(`To enable auto-refresh on ${platform}, smith will inject a SessionStart`);
    printErr(`hook into the installed agent file.`);
  }
  printErr("");
  printErr("Allow? [Y/n/details]");
}

function printConsentDetails(
  config: CanonicalConfig,
  platform: PlatformId,
  printErr: (msg: string) => void,
): void {
  printErr("");
  if (platform === "codex") {
    printErr("The following entry will be merged into ~/.codex/hooks.json:");
    printErr("");
    printErr("  hooks.SessionStart:");
    printErr("    - matcher: startup|resume");
    printErr("      hooks:");
    printErr("        - type: command");
    printErr(`          command: smith knowledge refresh-session --platform codex`);
    printErr("          statusMessage: smith: refreshing knowledge…");
    printErr("          timeout: 5");
    printErr("");
    printErr(`  _smith_managed.agents: [..., "${config.name}"]`);
    printErr("");
    printErr("After install, run /hooks inside codex once to trust the entry.");
    printErr("Uninstall (smith agent uninstall) removes the agent from the list,");
    printErr("and deletes hooks.json when the last smith agent is removed.");
  } else if (platform === "opencode") {
    printErr("smith will install (or update) an OpenCode plugin at:");
    printErr("  ~/.config/opencode/plugins/agent-smith-refresh/");
    printErr("and register it in ~/.config/opencode/opencode.json.");
    printErr("");
    printErr("OpenCode has no per-session-agent scoping, so the plugin");
    printErr("refreshes the superset of all installed OpenCode agents on each");
    printErr("session.created event.");
    printErr("");
    printErr(`  plugins/agent-smith-refresh/.smith-managed.agents: [..., "${config.name}"]`);
    printErr("");
    printErr("Uninstall (smith agent uninstall) removes the agent from the list,");
    printErr("and deletes the plugin dir + opencode.json entry when the last");
    printErr("smith agent opts out.");
  } else {
    printErr("The following YAML block will be added to the agent frontmatter:");
    printErr("");
    printErr("  hooks:");
    printErr("    SessionStart:");
    printErr("      - matcher: startup|resume");
    printErr("        hooks:");
    printErr("          - type: command");
    printErr(
      `            command: smith knowledge refresh-session --agent ${config.name} --platform ${platform}`,
    );
    printErr(`            statusMessage: Refreshing ${config.name} knowledge…`);
    printErr("            timeout: 5");
    printErr("");
    printErr("Uninstall (smith agent uninstall) removes this block automatically.");
  }
  printErr("");
}
