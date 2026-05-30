import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import ora, { type Ora } from "ora";
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
    const installPaths: InstallPaths = krPaths?.installPaths ?? defaultInstallPaths();
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
