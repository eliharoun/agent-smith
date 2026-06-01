import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import ora, { type Ora } from "ora";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { atomicWriteText } from "../../io/atomic-write";
import claudeCodeData from "../../../data/claude-code-tool-map.json" with { type: "json" };
import codexData from "../../../data/codex-tool-map.json" with { type: "json" };
import kiroData from "../../../data/kiro-tool-map.json" with { type: "json" };
import vendoredSchema from "../../../data/opencode.config.schema.json" with { type: "json" };
import schemaMetaRaw from "../../../data/opencode.config.schema.meta.json" with { type: "json" };
import type { RefreshPlatformId } from "../../core/freshness/check-refresh-hooks";
import { formatFailuresOnly, formatReport, formatReportCompact } from "../../core/freshness/format";
import { parseSchemaMeta, parseToolMapMeta } from "../../core/freshness/meta-schema";
import type {
  CapturedSectionSummary,
  DoctorSectionDoneEvent,
  DoctorSectionId,
  DoctorSectionStartEvent,
} from "../../core/freshness/run-doctor";
import { runDoctor } from "../../core/freshness/run-doctor";
import type { DoctorDeps, SchemaCache } from "../../core/freshness/types";
import { CURATED_FALLBACK_V0_6_0 } from "../../core/model-resolution";
import { toMessage } from "../../core/to-message";
import type { InstallPaths } from "../../core/types";
import { defaultCacheRoot } from "../../io/cache-root";
import { hashContent, loadInstalledAgents } from "../../io/installed-agents";
import { hashSkillDir, loadInstalledSkills } from "../../io/installed-skills";
import { getOpenCodeModels } from "../../io/opencode-models";
import { detectInstalledPlatforms, findOnPath, type PlatformId } from "../../io/platform-detect";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { canonicalSkillRegistryPath } from "../../io/skill-registry";
import { isDebug } from "../debug-flag";
import {
  defaultAgentSmithHome,
  defaultCodexHome,
  defaultInstallPaths,
  defaultOpencodeConfigHome,
} from "../install-paths";
import { loadAllBundles, warnAllLoadFailures } from "../load-all";
import { defaultRunGit, type GitRunner } from "../registry-validation";
import { reconfigureAgent } from "./agent/reconfigure";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Human-readable refusal message printed when {@link detectInstalledPlatforms}
 * returns an empty set. Exported so integration tests can assert the exact
 * wording without duplicating it. The CLI returns exit code 2 (environment
 * error) in this case, consistent with the rest of the CLI taxonomy.
 *
 * The list of install one-liners is intentionally three lines (one per
 * supported platform). Add a new platform here when adding it to
 * {@link PLATFORM_BINARIES}.
 */
export const NO_PLATFORM_REFUSAL_MESSAGE = [
  "No supported AI coding platform detected on PATH.",
  "",
  "Install one of:",
  "  OpenCode:    https://opencode.ai/docs",
  "  Claude Code: npm i -g @anthropic-ai/claude-code",
  "  Codex:       npm i -g @openai/codex",
  "  Kiro:        curl -fsSL https://cli.kiro.dev/install | bash  (CLI)  /  https://kiro.dev/downloads/  (IDE)",
  "",
  "Then re-run `smith doctor`.",
].join("\n");

/**
 * Resolve the absolute realpath of the running smith binary once and
 * return a cached lookup the synchronous `resolveSmithPath` seam can
 * call per finding. The mcp-spawn-commands detector and the
 * --fix-mcp-commands repair share this resolver so detection and
 * rewrite agree on the path that gets persisted to disk.
 *
 * `process.argv[1]` is the JS entry the user invoked. realpath() walks
 * `bun-bin → ../bin/smith` shim symlinks so GUIs launched from
 * Spotlight/dock get the canonical absolute path even when the CLI
 * was invoked through a wrapper.
 */
async function buildSmithPathResolver(): Promise<() => string | null> {
  const entry = process.argv[1];
  if (!entry || typeof entry !== "string" || entry.length === 0) {
    return () => null;
  }
  let resolved: string;
  try {
    resolved = await realpath(entry);
  } catch {
    resolved = entry;
  }
  return () => resolved;
}

/**
 * Default per-platform MCP config paths. Mirrors the four readers the
 * mcp-spawn-commands check walks: opencode JSON, claude-code JSON, codex
 * TOML, and kiro JSON. Kept here (rather than in the check module) so the
 * CLI is the single source for filesystem layout and the check stays a
 * pure orchestration target.
 */
export function defaultMcpSpawnPaths(): import("../../core/freshness/check-mcp-spawn").McpSpawnPaths {
  const home = homedir();
  return {
    opencodeConfig: join(home, ".config", "opencode", "opencode.json"),
    claudeMcpConfig: join(home, ".claude.json"),
    codexConfig: join(home, ".codex", "config.toml"),
    kiroMcpConfig: join(home, ".kiro", "settings", "mcp.json"),
  };
}

/**
 * Production cache path. Honors `XDG_CACHE_HOME` (treats unset and empty as
 * unset), otherwise falls back to `~/.cache/agent-smith/...`.
 */
export function defaultCachePath(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "agent-smith", "opencode-schema-cache.json");
}

async function readCacheFromDisk(path: string): Promise<SchemaCache | null> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as Partial<SchemaCache>;
    if (
      typeof parsed.fetchedAt !== "string" ||
      typeof parsed.schema !== "object" ||
      parsed.schema === null ||
      Array.isArray(parsed.schema)
    ) {
      return null;
    }
    return parsed as SchemaCache;
  } catch {
    return null;
  }
}

async function writeCacheToDisk(path: string, value: SchemaCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

export interface DoctorCliOptions {
  offline: boolean;
  noCache: boolean;
  json: boolean;
  cachePath?: string;
  print?: (line: string) => void;
  /** Override the fetch implementation; defaults to global `fetch`. Used by tests to assert no network calls. */
  fetch?: DoctorDeps["fetch"];
  /** v0.6.0: skip the model-resolution check. Default false. */
  skipModelResolution?: boolean;
  /** Print full per-section detail report (today's pre-v0.13 behavior). Default false. */
  verbose?: boolean;
  /** Suppress all human output; preserve exit code. Default false. JSON still emits when --json. */
  quiet?: boolean;
  /** Override for tests. Defaults to canonicalRegistryPath(). */
  registryPath?: string;
  /** Override for tests. Defaults to canonicalSkillRegistryPath(). */
  skillRegistryPath?: string;
  /** Override for tests. Defaults to defaultRunGit. */
  runGit?: GitRunner;
  /**
   * Override for tests: detect which platform CLIs are installed. Defaults
   * to {@link detectInstalledPlatforms} which probes PATH for `opencode`,
   * `claude`, and `codex`. Tests inject this to keep runs hermetic against
   * the developer's local PATH state.
   */
  detectInstalledPlatforms?: () => Promise<Set<PlatformId>>;
  /**
   * v0.13.x: when true, after running the knowledge-refresh detection
   * section, iterate `report.knowledgeRefresh.findings` and auto-repair
   * each per its `kind`:
   *
   *   - missing-hook       → reconfigureAgent re-registers the hook
   *   - corrupt-cache      → delete the `.meta.json` (next refresh re-fetches)
   *   - orphaned-consent   → reconfigureAgent removes the platform from the manifest
   *   - unmanaged-codex-hooks → defer to `smith knowledge migrate-codex`
   *                              (no auto-fix; user intent required)
   *
   * Per-finding errors print but do NOT abort the repair pass.
   */
  fixKnowledgeRefresh?: boolean;
  /**
   * Override for tests: paths consumed by the knowledge-refresh section
   * (both detection and `--fix-knowledge-refresh` repair). When omitted,
   * defaults match the production helpers (`defaultAgentSmithHome()`,
   * `defaultCacheRoot()`, etc.). The same paths are threaded into
   * `reconfigureAgent` so the repair touches the same on-disk state the
   * detector inspected.
   */
  knowledgeRefreshPaths?: {
    agentSmithHome: string;
    cacheRoot: string;
    installPaths: Record<RefreshPlatformId, string>;
    codexHome: string;
    opencodeConfigHome: string;
  };
  /**
   * v2.0: when true, after running the knowledge-compile detection section,
   * iterate `report.knowledgeCompile.findings` and re-run
   * `runKnowledgeCompile({ name })` for each missing-manifest / drift
   * finding. The repair both re-materializes sources (so any underlying
   * source change is picked up) and overwrites a corrupt `compile-manifest.json`.
   * Per-finding errors print but do NOT abort the repair pass.
   */
  fixKnowledgeCompile?: boolean;
  /**
   * Override for tests: knowledge-compile detection inputs. When omitted,
   * production wiring derives candidates from the registered bundles and
   * uses `defaultAgentSmithHome()`. Tests inject in-memory bundles and a
   * tmpdir agent-smith home so the section runs hermetically.
   */
  knowledgeCompile?: {
    agentSmithHome: string;
    /**
     * Returns the bundles whose `knowledge.compile.progressive=true` should
     * be considered. Tests pass an in-memory list. The default wiring walks
     * the registry via `loadAllBundles`.
     */
    loadAllBundles: () => Promise<import("../../core/types").AgentBundle[]>;
  };
  /**
   * v2.1.x: when true, after running the mcp-spawn-commands detection
   * section, iterate `report.mcpSpawnCommands.findings` and rewrite each
   * finding's platform config so the `command` field is the absolute path
   * computed during detection. Findings with `resolvedAbsolute === null`
   * are skipped with a warning ("can't auto-fix; install <name> first").
   * Per-finding errors print but do NOT abort the repair pass.
   */
  fixMcpCommands?: boolean;
  /**
   * Override for tests: paths consumed by the mcp-spawn-commands detection
   * section AND the auto-fix repair. When omitted the production wiring
   * uses the canonical home-relative paths defined here. Tests inject a
   * tmpdir set so the section runs hermetically against fixtures.
   *
   * The optional `which` and `resolveSmithPath` seams thread into the
   * detector and are reused by the auto-fix path so a single set of
   * fixtures determines both detection findings and the repair targets.
   */
  mcpSpawn?: {
    paths: import("../../core/freshness/check-mcp-spawn").McpSpawnPaths;
    which?: (command: string) => string | null;
    resolveSmithPath?: () => string | null;
  };
}

/**
 * Production wiring for `smith doctor`. Builds real {@link DoctorDeps}
 * (live fetch, XDG-aware disk cache, system clock) from CLI flags + vendored
 * data files, runs the pure {@link runDoctor} orchestrator, and prints the
 * report (human or JSON). Returns the literal exit code (0/1/2).
 *
 * Tests inject `opts.fetch` and `opts.cachePath` to keep runs hermetic.
 */
export async function runDoctorCli(opts: DoctorCliOptions): Promise<number> {
  const print = opts.print ?? ((s: string) => console.log(s));
  const cachePath = opts.cachePath ?? defaultCachePath();
  const installedPlatforms = await (opts.detectInstalledPlatforms ?? detectInstalledPlatforms)();

  // Refuse to run when no supported platform CLI is on PATH. Every section
  // of the report is either platform-scoped (filtered out by the runDoctor
  // gating from task 5) or cross-cutting in a way that's meaningless without
  // a platform installed (registry hygiene listing skills for absent
  // runtimes, etc.). The exit-2 environment-error code matches the rest of
  // the CLI taxonomy; the install hint is the actionable next step.
  if (installedPlatforms.size === 0) {
    if (opts.json) {
      print(
        JSON.stringify(
          {
            error: "no-platform-detected",
            message: NO_PLATFORM_REFUSAL_MESSAGE,
            exitCode: 2,
          },
          null,
          2,
        ),
      );
    } else {
      print(NO_PLATFORM_REFUSAL_MESSAGE);
    }
    return 2;
  }

  const schemaMeta = parseSchemaMeta(schemaMetaRaw);
  const claudeMeta = parseToolMapMeta((claudeCodeData as { _meta: unknown })._meta);
  const codexMeta = parseToolMapMeta((codexData as { _meta: unknown })._meta);
  const kiroMeta = parseToolMapMeta((kiroData as { _meta: unknown })._meta);

  const deps: DoctorDeps = {
    fetch: opts.fetch ?? ((url) => fetch(url)),
    now: () => new Date(),
    readCache: readCacheFromDisk,
    writeCache: writeCacheToDisk,
    cachePath,
    ttlMs: TTL_MS,
    offline: opts.offline,
    noCache: opts.noCache,
  };

  const modelResolutionCfg = opts.skipModelResolution
    ? undefined
    : {
        getOpenCodeModels:
          process.env.AGENT_SMITH_DISABLE_LIVE_RESOLUTION === "1"
            ? async () => undefined
            : getOpenCodeModels,
        findOpencodeOnPath: () => findOnPath("opencode"),
        installedPaths: {
          opencodeAgentsDir: join(homedir(), ".config/opencode/agents"),
          claudeCodeAgentsDir: join(homedir(), ".claude/agents"),
          codexAgentsDir: join(homedir(), ".agents/skills"),
        },
        curatedFallback: CURATED_FALLBACK_V0_6_0,
      };

  // Stream per-section progress with ora when stdout is a TTY and we're not
  // emitting JSON or suppressing output.
  const useStreaming = !opts.json && !opts.quiet && process.stdout.isTTY === true;
  const spinners = new Map<DoctorSectionId, Ora>();

  // Captured summaries: needed by formatReportCompact / formatFailuresOnly so
  // those formatters don't have to re-derive summary strings from the report.
  // Always installed (capture is cheap); useStreaming gates only spinner side
  // effects.
  const labels = new Map<DoctorSectionId, string>();
  const captured: CapturedSectionSummary[] = []; // consumed by formatReportCompact / formatFailuresOnly (Task 4)

  const onSectionStart = (e: DoctorSectionStartEvent) => {
    labels.set(e.id, e.label);
    if (useStreaming) {
      try {
        const spinner = ora({ text: e.label, color: "cyan" }).start();
        spinners.set(e.id, spinner);
      } catch (err) {
        // Defensive: a failed spinner mustn't crash doctor.
        if (isDebug()) {
          console.error(`[doctor] spinner start failed for ${e.id}: ${toMessage(err)}`);
        }
      }
    }
  };

  const onSectionDone = (e: DoctorSectionDoneEvent) => {
    captured.push({
      id: e.id,
      label: labels.get(e.id) ?? e.id,
      status: e.status,
      summary: e.summary,
    });
    if (useStreaming) {
      try {
        const spinner = spinners.get(e.id);
        if (!spinner) return;
        switch (e.status) {
          case "ok":
            spinner.succeed(e.summary);
            break;
          case "warn":
            spinner.warn(e.summary);
            break;
          case "error":
            spinner.fail(e.summary);
            break;
          case "skipped":
            spinner.info(e.summary);
            break;
        }
        spinners.delete(e.id);
      } catch (err) {
        // Defensive: see above.
        if (isDebug()) {
          console.error(`[doctor] spinner finalize failed for ${e.id}: ${toMessage(err)}`);
        }
      }
    }
  };

  // Load every registered bundle once: feeds both the required-skills
  // section and the Atlassian-auth relevance signal.
  const agentReg = await loadRegistry(canonicalRegistryPath());
  const bundleResult = await loadAllBundles(agentReg);
  warnAllLoadFailures(bundleResult.failures, (m) => console.error(m));
  const hasAtlassianKnowledgeSources = bundleResult.bundles.some((b) =>
    (b.config.knowledge?.sources ?? []).some((s) => s.type === "confluence" || s.type === "jira"),
  );

  // Build knowledge-compile detection candidates from every bundle that
  // opts in to progressive compile. Tests inject `opts.knowledgeCompile`
  // with their own bundle list + tmpdir agent-smith home.
  const knowledgeCompileAgentSmithHome =
    opts.knowledgeCompile?.agentSmithHome ?? defaultAgentSmithHome();
  const knowledgeCompileBundles = opts.knowledgeCompile
    ? await opts.knowledgeCompile.loadAllBundles()
    : bundleResult.bundles;
  const knowledgeCompileCandidates = knowledgeCompileBundles
    .filter((b) => b.config.knowledge?.compile?.progressive === true)
    .map((b) => {
      const compileBlock = b.config.knowledge?.compile;
      return {
        name: b.config.name,
        knowledgeDir: join(knowledgeCompileAgentSmithHome, "knowledge", b.config.name),
        compileOptions: {
          progressive: true,
          tocMaxLines: compileBlock?.tocMaxLines ?? 150,
          emitAgentsMd: compileBlock?.emitAgentsMd ?? false,
        },
      };
    });

  const report = await runDoctor({
    vendoredSchema: vendoredSchema as Record<string, unknown>,
    schemaMeta,
    claudeMeta,
    codexMeta,
    kiroMeta,
    deps,
    installedPlatforms,
    ...(modelResolutionCfg ? { modelResolution: modelResolutionCfg } : {}),
    onSectionStart,
    onSectionDone,
    workspace: { importMetaUrl: import.meta.url, offline: opts.offline },
    skillDrift: {
      loadInstalled: loadInstalledSkills,
      hashDir: hashSkillDir,
      pathExists: async (p: string) => {
        try {
          const s = await stat(p);
          return s.isDirectory();
        } catch {
          return false;
        }
      },
    },
    agentDrift: {
      loadInstalled: loadInstalledAgents,
      hashFile: async (p: string) => hashContent(await readFile(p, "utf8")),
      pathExists: async (p: string) => {
        try {
          const s = await stat(p);
          return s.isFile();
        } catch {
          return false;
        }
      },
    },
    hasAtlassianKnowledgeSources,
    loadAgentsForDoctor: async () =>
      bundleResult.bundles.map((b) => ({
        name: b.config.name,
        ...(b.config.requires ? { requires: b.config.requires } : {}),
      })),
    loadInstalledSkillNames: async () => {
      const file = await loadInstalledSkills();
      return file.installed.map((e) => e.name);
    },
    registryHygiene: {
      registryPath: opts.registryPath ?? canonicalRegistryPath(),
      skillRegistryPath: opts.skillRegistryPath ?? canonicalSkillRegistryPath(),
      runGit: opts.runGit ?? defaultRunGit,
    },
    remoteCatalogs: {
      // DW-4: wire the C3.14 remote-catalogs section into the CLI.
      // run-doctor.ts gates the section on the presence of this field;
      // without it the check never runs even though every catalog in
      // the user's registry has a `gitRemote`. Reusing the same path
      // overrides that registryHygiene uses keeps test plumbing
      // symmetric.
      registryPath: opts.registryPath ?? canonicalRegistryPath(),
      skillRegistryPath: opts.skillRegistryPath ?? canonicalSkillRegistryPath(),
    },
    duplicateCatalogs: {
      // [v1-task RC2-10] Always-on audit for duplicate gitRemotes
      // across both registries. Pure (no IO beyond reading the
      // registries already loaded by registryHygiene/remoteCatalogs)
      // and always informational, so there's no flag to gate it.
      registryPath: opts.registryPath ?? canonicalRegistryPath(),
      skillRegistryPath: opts.skillRegistryPath ?? canonicalSkillRegistryPath(),
    },
    knowledgeRefresh: {
      agentSmithHome: opts.knowledgeRefreshPaths?.agentSmithHome ?? defaultAgentSmithHome(),
      cacheRoot: opts.knowledgeRefreshPaths?.cacheRoot ?? defaultCacheRoot(),
      installPaths: opts.knowledgeRefreshPaths?.installPaths ?? defaultInstallPaths(),
      codexHooksPath: join(
        opts.knowledgeRefreshPaths?.codexHome ?? defaultCodexHome(),
        "hooks.json",
      ),
      opencodeConfigHome:
        opts.knowledgeRefreshPaths?.opencodeConfigHome ?? defaultOpencodeConfigHome(),
    },
    knowledgeCompile: { candidates: knowledgeCompileCandidates },
    mcpSpawnCommands: {
      paths: opts.mcpSpawn?.paths ?? defaultMcpSpawnPaths(),
      ...(opts.mcpSpawn?.which ? { which: opts.mcpSpawn.which } : {}),
      // Resolve `smith`'s realpath up-front so the synchronous resolver
      // seam can return it without doing FS work per-finding. The async
      // realpath() is a one-shot probe at startup; tests bypass this via
      // the explicit seam.
      resolveSmithPath: opts.mcpSpawn?.resolveSmithPath ?? (await buildSmithPathResolver()),
    },
  });

  // --- --fix-knowledge-refresh auto-repair ----------------------------------
  // Runs AFTER detection but BEFORE the renderer so any console output from
  // the repair pass is grouped with the section it relates to. Per-finding
  // errors print and the loop continues — one bad repair must not abort
  // sibling repairs (e.g. a corrupt-cache deletion shouldn't be skipped
  // because a missing-hook re-register threw).
  if (
    opts.fixKnowledgeRefresh &&
    report.knowledgeRefresh &&
    report.knowledgeRefresh.findings.length > 0
  ) {
    const krPaths = opts.knowledgeRefreshPaths;
    const cacheRoot = krPaths?.cacheRoot ?? defaultCacheRoot();
    // krPaths.installPaths is keyed by RefreshPlatformId (the four
    // refresh-capable platforms) and is therefore a strict subset of
    // InstallPaths. Backfill the agents-md key from defaults so the
    // value satisfies InstallPaths after the T5a widening — agents-md
    // has no refresh hooks and the reconfigureAgent code path never
    // reads paths["agents-md"], so the value is inert here.
    const installPaths: InstallPaths = krPaths?.installPaths
      ? { ...krPaths.installPaths, "agents-md": defaultInstallPaths()["agents-md"] }
      : defaultInstallPaths();
    const reconfigureDeps = {
      agentSmithHome: krPaths?.agentSmithHome ?? defaultAgentSmithHome(),
      paths: installPaths,
      codexHome: krPaths?.codexHome ?? defaultCodexHome(),
      opencodeHome: krPaths?.opencodeConfigHome ?? defaultOpencodeConfigHome(),
    };

    for (const f of report.knowledgeRefresh.findings) {
      try {
        switch (f.kind) {
          case "missing-hook":
            // reconfigureAgent's grant path is idempotent against the
            // manifest: if the platform is already recorded (which it IS,
            // by definition — missing-hook means the manifest claims
            // consent), the underlying register primitive is skipped. So
            // we explicitly revoke first (clears the manifest entry, no-op
            // on the absent hook primitive), then grant (re-runs the
            // register primitive, adds the entry back). End state: the
            // hook is registered on disk and the manifest is unchanged.
            await reconfigureAgent(f.agent, { grant: [], revoke: [f.platform] }, reconfigureDeps);
            await reconfigureAgent(f.agent, { grant: [f.platform], revoke: [] }, reconfigureDeps);
            print(`  ✓ re-registered ${f.platform} hook for ${f.agent}`);
            break;
          case "corrupt-cache": {
            const target = join(cacheRoot, "agents", f.agent, "sources", `${f.sourceId}.meta.json`);
            await rm(target, { force: true });
            print(`  ✓ deleted corrupt cache: ${f.agent}/${f.sourceId}`);
            break;
          }
          case "orphaned-consent":
            await reconfigureAgent(f.agent, { grant: [], revoke: [f.platform] }, reconfigureDeps);
            print(`  ✓ cleared orphan consent: ${f.agent}/${f.platform}`);
            break;
          case "unmanaged-codex-hooks":
            print(`  ! ${f.path} requires manual migration: run 'smith knowledge migrate-codex'`);
            break;
          default: {
            const _exhaustive: never = f;
            throw new Error(
              `unhandled knowledge-refresh finding kind: ${(_exhaustive as { kind: string }).kind}`,
            );
          }
        }
      } catch (err) {
        print(`  ✗ repair failed for ${f.kind}: ${toMessage(err)}`);
      }
    }
  }

  // --- --fix-knowledge-compile auto-repair ---------------------------------
  // Runs AFTER detection. For each missing-manifest / drift finding, re-run
  // `runKnowledgeCompile({ name })` against the same bundle list the
  // detector inspected. This both re-materializes sources (so any
  // underlying source change is picked up) and overwrites a corrupt or
  // missing `compile-manifest.json`. Per-finding errors print and the loop
  // continues — one bad repair must not abort sibling repairs.
  if (
    opts.fixKnowledgeCompile &&
    report.knowledgeCompile &&
    report.knowledgeCompile.findings.length > 0
  ) {
    const { runKnowledgeCompile } = await import("./knowledge/compile");
    const bundleByName = new Map<string, import("../../core/types").AgentBundle>();
    for (const b of knowledgeCompileBundles) bundleByName.set(b.config.name, b);
    const compilePaths = { agentSmithHome: knowledgeCompileAgentSmithHome };
    for (const f of report.knowledgeCompile.findings) {
      try {
        const bundle = bundleByName.get(f.agent);
        if (!bundle) {
          print(`  ✗ ${f.agent}: bundle not found in registry; skipping repair`);
          continue;
        }
        const code = await runKnowledgeCompile({
          name: f.agent,
          paths: compilePaths,
          loadBundle: async (n) => (n === f.agent ? bundle : null),
        });
        if (code === 0) {
          print(`  ✓ recompiled ${f.agent} (${f.kind})`);
        } else {
          print(`  ✗ recompile of ${f.agent} exited ${code}`);
        }
      } catch (err) {
        print(`  ✗ repair failed for ${f.agent}: ${toMessage(err)}`);
      }
    }
  }

  // --- --fix-mcp-commands auto-repair ---------------------------------------
  // Runs AFTER detection. For each fragile-spawn finding with a non-null
  // `resolvedAbsolute`, rewrite the platform's config so the `command`
  // field is the absolute path. Per-platform writers preserve the rest of
  // the file verbatim (other entries, unrelated top-level keys). Findings
  // with a null `resolvedAbsolute` print a "can't auto-fix" warning and
  // are skipped — installing the missing binary is the user's next step.
  if (
    opts.fixMcpCommands &&
    report.mcpSpawnCommands &&
    report.mcpSpawnCommands.findings.length > 0
  ) {
    for (const f of report.mcpSpawnCommands.findings) {
      if (f.resolvedAbsolute === null) {
        print(`  ! can't auto-fix '${f.command}' (${f.platform}/${f.serverName}): install ${f.command} first`);
        continue;
      }
      try {
        await rewriteMcpCommand(f.platform, f.configPath, f.serverName, f.resolvedAbsolute);
        print(`  ✓ rewrote ${f.platform}/${f.serverName} command → ${f.resolvedAbsolute}`);
      } catch (err) {
        print(`  ✗ rewrite failed for ${f.platform}/${f.serverName}: ${toMessage(err)}`);
      }
    }
  }

  if (opts.json) {
    // JSON contract is unchanged regardless of --verbose / --quiet.
    print(JSON.stringify(report, null, 2));
    return report.exitCode;
  }

  if (opts.quiet) {
    // Suppress all human output; preserve exit code.
    return report.exitCode;
  }

  if (opts.verbose) {
    // Today's full per-section detail report.
    if (useStreaming) print("");
    print(formatReport(report));
    return report.exitCode;
  }

  // Default mode: compact summary + auto-expanded warn/error sections + footer.
  if (useStreaming) {
    // TTY: spinner already streamed the summary lines.
    print("");
    print(formatFailuresOnly(report, captured));
  } else {
    // Non-TTY: nothing has been printed yet; emit static summary lines too.
    print(formatReportCompact(report, captured));
  }
  return report.exitCode;
}

// ---------------------------------------------------------------------------
// MCP-command rewriters — one per platform. Each preserves all unrelated
// content (other entries, unrelated top-level keys) and only mutates the
// `command` field of the named server. Atomic-write semantics match the
// GUI's mcp-config.ts so the file is never half-written.
//
// Why these live in the CLI rather than in `core/freshness/check-mcp-spawn.ts`:
// the detector is read-only by design (mirrors check-knowledge-compile and
// check-refresh-hooks). Repair is a CLI concern threaded through `--fix-*`
// flags. Co-locating the writers with the existing repair loops also keeps
// the imports of `smol-toml` confined to one file.
// ---------------------------------------------------------------------------

async function rewriteMcpCommand(
  platform: "opencode" | "claude-code" | "codex" | "kiro",
  configPath: string,
  serverName: string,
  newCommand: string,
): Promise<void> {
  switch (platform) {
    case "opencode":
      await rewriteJsonCommand(configPath, "mcp", serverName, newCommand);
      return;
    case "claude-code":
      await rewriteClaudeCommand(configPath, serverName, newCommand);
      return;
    case "codex":
      await rewriteCodexTomlCommand(configPath, serverName, newCommand);
      return;
    case "kiro":
      await rewriteJsonCommand(configPath, "mcpServers", serverName, newCommand);
      return;
  }
}

async function rewriteJsonCommand(
  path: string,
  key: string,
  serverName: string,
  newCommand: string,
): Promise<void> {
  const text = await readFile(path, "utf8");
  const data = JSON.parse(text) as Record<string, unknown>;
  const block = data[key];
  if (!block || typeof block !== "object" || Array.isArray(block)) return;
  const rec = block as Record<string, unknown>;
  const entry = rec[serverName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  (entry as Record<string, unknown>).command = newCommand;
  await atomicWriteText(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Claude Code splits servers between `mcpServers` (user) and
 *  `projects.<dir>.mcpServers` (local). Walk both; rewrite the first match
 *  by name. Per-finding granularity keeps rewrite scope minimal. */
async function rewriteClaudeCommand(
  path: string,
  serverName: string,
  newCommand: string,
): Promise<void> {
  const text = await readFile(path, "utf8");
  const data = JSON.parse(text) as Record<string, unknown>;
  if (rewriteCommandIn(data.mcpServers, serverName, newCommand)) {
    await atomicWriteText(path, `${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const projects = data.projects;
  if (projects && typeof projects === "object" && !Array.isArray(projects)) {
    for (const project of Object.values(projects as Record<string, unknown>)) {
      if (!project || typeof project !== "object" || Array.isArray(project)) continue;
      if (
        rewriteCommandIn(
          (project as Record<string, unknown>).mcpServers,
          serverName,
          newCommand,
        )
      ) {
        await atomicWriteText(path, `${JSON.stringify(data, null, 2)}\n`);
        return;
      }
    }
  }
}

function rewriteCommandIn(
  block: unknown,
  serverName: string,
  newCommand: string,
): boolean {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const rec = block as Record<string, unknown>;
  const entry = rec[serverName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  (entry as Record<string, unknown>).command = newCommand;
  return true;
}

async function rewriteCodexTomlCommand(
  path: string,
  serverName: string,
  newCommand: string,
): Promise<void> {
  const text = await readFile(path, "utf8");
  const data = parseToml(text) as Record<string, unknown>;
  const block = data.mcp_servers;
  if (!block || typeof block !== "object" || Array.isArray(block)) return;
  const rec = block as Record<string, unknown>;
  const entry = rec[serverName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  (entry as Record<string, unknown>).command = newCommand;
  await atomicWriteText(path, stringifyToml(data));
}
