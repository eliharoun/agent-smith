import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultKnowledgePaths } from "../cli/install-paths";
import { assembleBody } from "../core/assembler";
import type { CompiledKnowledge } from "../core/knowledge/compile";
import { runKnowledgeStage } from "../core/knowledge/pipeline";
import { mergeCacheEntry, writeRefreshCache } from "../core/knowledge/refresh-cache";
import { acquireInstallLock, releaseRefreshLock } from "../core/knowledge/refresh-lock";
import { loadAndMergeKnowledge } from "../core/knowledge/sidecar";
import type { KnowledgeSection } from "../core/knowledge/types";
import { DEFAULT_INLINE_BUDGET } from "../core/knowledge/validator";
import { type ModelResolutionEnv, RESOLVERS } from "../core/model-resolution";
import { PlatformUnavailableError } from "../core/model-resolution/types";
import { SmithError } from "../core/smith-error";
import { renderForTargets } from "../core/translators";
import type { AgentBundle, InstallPaths, RenderedAgent, SourceKind, Target } from "../core/types";
import { validate, validateAssembledTotal } from "../core/validator";
import { defaultCacheRoot } from "./cache-root";
import { detectAuthenticatedProviders } from "./opencode-auth";
import { type InstallResult, installRendered } from "./installer";
import { cacheDirFor, type KnowledgePaths, knowledgeDirFor } from "./knowledge-paths";
import type { KnowledgeSummary } from "./knowledge-summary";
import { defaultReadPriorManifest, summarizeKnowledgeStage } from "./knowledge-summary";
import { checkMcpAvailability, type McpAvailabilityPaths } from "./mcp-availability";
import { getOpenCodeModels } from "./opencode-models";
import { checkSkillAvailability, type SkillAvailabilityPaths } from "./skill-availability";

const PRECEDENCE: Record<SourceKind, number> = {
  project: 0,
  "user-global": 1,
  registered: 2,
};

export function sortByPrecedence(bundles: AgentBundle[]): AgentBundle[] {
  return [...bundles].sort((a, b) => PRECEDENCE[a.source.kind] - PRECEDENCE[b.source.kind]);
}

export interface OrchestratorResult {
  installed: InstallResult["installed"];
  /** Renders the installer skipped because the target file was already byte-identical. */
  skipped: InstallResult["skipped"];
  warnings: string[];
  errors: { agent: string; messages: string[] }[];
  /**
   * Per-agent knowledge directories that the install granted implicit read
   * access to. CLI rendering (install summary line) consumes this.
   */
  grantedKnowledgeDirs: { agent: string; dir: string }[];
  /**
   * Per-agent knowledge materialization summary. Populated for agents whose
   * knowledge block has at least one source. Consumed by the install CLI to
   * print per-source `→ knowledge <id>` / `· knowledge <id> (unchanged)`
   * lines and an aggregate tally. Empty array when no agent has knowledge.
   */
  knowledge: KnowledgeSummary[];
}

function defaultSkillPaths(sourceRoots: string[]): SkillAvailabilityPaths {
  return {
    sourceRoots,
    opencodeSkillsDir: join(homedir(), ".config/opencode/skills"),
    claudeSkillsDir: join(homedir(), ".claude/skills"),
    // Codex's USER-scope skill location per https://developers.openai.com/codex/skills
    codexSkillsDir: join(homedir(), ".agents/skills"),
  };
}

function defaultMcpPaths(): McpAvailabilityPaths {
  return {
    opencodeConfig: join(homedir(), ".config/opencode/opencode.json"),
    claudeMcpConfig: join(homedir(), ".claude.json"),
    codexConfig: join(homedir(), ".codex/config.toml"),
  };
}

/**
 * For each bundle source, look for skills under a sibling `skills/` directory
 * relative to the bundle source root. E.g. for an agent root at
 * `~/.config/agent-smith/agents/`, skills are expected at
 * `~/.config/agent-smith/skills/`. Likewise for project layouts:
 * `.agent-smith/agents/` -> `.agent-smith/skills/`.
 */
export function deriveSkillSourceRoots(bundles: AgentBundle[]): string[] {
  return Array.from(new Set(bundles.map((b) => join(dirname(b.source.rootPath), "skills"))));
}

export interface BuildAndInstallOptions {
  skillPaths?: SkillAvailabilityPaths;
  mcpPaths?: McpAvailabilityPaths;
  /**
   * Where materialized knowledge lives. Defaults to `defaultKnowledgePaths()`
   * (`~/.config/agent-smith`). Tests inject a tmpdir so they don't touch the
   * user's real state.
   */
  knowledgePaths?: KnowledgePaths;
  /**
   * Inject a fake model-resolution environment. Tests use this to avoid
   * spawning `opencode`. Production omits and gets the live env.
   */
  modelResolutionEnv?: ModelResolutionEnv;
  /**
   * Per-agent opt-in for emitting refresh hooks into target frontmatter.
   * Keyed by `bundle.config.name`. Absent or `false` means the rendered
   * agent file will NOT contain a SessionStart hook block, even if the
   * canonical config declares session/always knowledge sources.
   *
   * Only the install CLI populates this map, and only after explicit
   * user consent (interactive prompt or `--refresh-consent yes`) and
   * only when `--no-refresh-hooks` was not passed. Daemon / programmatic
   * callers get the safe fail-closed default and must not silently
   * install hooks. See spec §5.2.
   */
  withRefreshHooksFor?: Map<string, boolean>;
  /**
   * Root of the refresh-cache (`<cacheRoot>/agents/<agent>/sources/...`).
   * Defaults to `defaultCacheRoot()` (`$XDG_CACHE_HOME/agent-smith` or
   * `~/.cache/agent-smith`). Tests inject a tmpdir.
   *
   * The orchestrator writes per-source `.meta.json` here after each
   * successfully-rendered knowledge stage so the GUI can show "last
   * refreshed N minutes ago" on first install (previously meta was only
   * written by `knowledge fetch`, the refresh-session runner, and the
   * daemon, leaving the GUI stuck on "pending" until something else ran).
   */
  cacheRoot?: string;
  /**
   * Test seam for the installed-agents manifest's home dir. Production
   * omits and gets `stateHome()` (honors XDG_CONFIG_HOME). Threaded
   * through to `installRendered` so tests can inject a tmpdir and avoid
   * polluting the user's real `~/.config/agent-smith/installed-agents.json`.
   */
  homeDir?: string;
  /**
   * Bypass the would-clobber refusal during install (overwrites a non-smith
   * file at the destination). Threaded through to `installRendered`. Wired
   * to the `--force` CLI flag in Task 1.5.
   */
  force?: boolean;
  /**
   * PlatformConventions resolution strategy (Task 3.5/3.6). When set, the
   * orchestrator calls resolveConventions per target with this as the
   * cliFlag tier and threads the resolved URIs into renderForTargets via
   * injectPlatformConventions.
   */
  platformConventions?: import("../io/conventions").DefaultStrategy;
  /**
   * Test seam for the conventions prompt callback (TTY tier in
   * resolveConventions). Production callers omit; the resolver uses
   * fail-safe-reject when isTty is false (the default for the orchestrator).
   */
  promptForConventions?: (
    target: Target,
    options: readonly import("../core/platform-conventions").PlatformConvention[],
  ) => Promise<string[]>;
  /**
   * TTY signal for conventions resolution. Defaults to false; the orchestrator
   * is downstream of the CLI's TTY check, and a non-TTY default keeps
   * automation safe (resolver uses fail-safe-reject).
   */
  isTty?: boolean;
  /**
   * Opt-out for the v1-task-B7 install-time MCP availability check.
   *
   * Default (`false` / undefined): any MCP server listed in
   * `config.mcpServers` that is NOT present in the relevant platform's
   * MCP config aborts that bundle's install. The error message includes
   * a remediation hint (configure the server in
   * `~/.config/opencode/opencode.json` / `~/.claude.json` / `~/.codex/config.toml`)
   * AND mentions `--allow-missing-mcp` as the explicit escape hatch.
   *
   * Set to `true` (e.g. via `smith agent install --allow-missing-mcp`)
   * to demote the failure back to a warning. Use sparingly — the v1
   * contract says "if the bundle declares it, it's required."
   */
  allowMissingMcp?: boolean;
  /**
   * Set to true (e.g. via `smith agent install --allow-missing-cli`) to render
   * a target whose platform CLI is absent — the resolver emits the static tier
   * literal + a warning instead of throwing. Default false (drop the target).
   */
  allowMissingCli?: boolean;
}

/**
 * Validate, render, and install agent bundles to their target platforms.
 *
 * Abort-on-error contract: if ANY per-bundle error occurs (validation failure,
 * knowledge-stage error, MCP availability check, lock contention), the entire
 * batch aborts — `installRendered` is never called. With the atomic swap in
 * pipeline.ts (Task 3, commit eb2895b), the prior knowledge dir state is
 * preserved bit-for-bit on abort. No installs proceed; render targets remain
 * at their previous successful state.
 */
export async function buildAndInstall(
  bundles: AgentBundle[],
  paths: InstallPaths,
  options: BuildAndInstallOptions = {},
): Promise<OrchestratorResult> {
  const sorted = sortByPrecedence(bundles);
  const allRendered: RenderedAgent[] = [];
  const warnings: string[] = [];
  const errors: OrchestratorResult["errors"] = [];
  const grantedKnowledgeDirs: OrchestratorResult["grantedKnowledgeDirs"] = [];
  const knowledge: KnowledgeSummary[] = [];

  const allSourceRoots = deriveSkillSourceRoots(sorted);
  const resolvedSkillPaths = options.skillPaths ?? defaultSkillPaths(allSourceRoots);
  const resolvedMcpPaths = options.mcpPaths ?? defaultMcpPaths();
  const resolvedKnowledgePaths = options.knowledgePaths ?? defaultKnowledgePaths();
  const resolvedCacheRoot = options.cacheRoot ?? defaultCacheRoot();

  // If the caller injected a modelResolutionEnv (typically tests), use it
  // verbatim — its warning collector is already wired the way the test wants.
  // Otherwise build a fresh env *per bundle* below so resolver warnings can be
  // prefixed `[<agent-name>/<target>]`, matching the convention used for
  // translator warnings (line 133).
  const injectedModelEnv = options.modelResolutionEnv;
  const liveGetModels =
    process.env.AGENT_SMITH_DISABLE_LIVE_RESOLUTION === "1"
      ? async () => undefined
      : getOpenCodeModels;

  for (const bundle of sorted) {
    const modelEnv: ModelResolutionEnv = injectedModelEnv ?? {
      getOpenCodeModels: liveGetModels,
      warnings: {
        push(w) {
          warnings.push(`[${bundle.config.name}/${w.target}] ${w.message}`);
        },
      },
      detectAuthenticatedProviders: async () => detectAuthenticatedProviders(),
      env: process.env,
      allowMissingCli: options.allowMissingCli ?? false,
    };
    const skillResult = await checkSkillAvailability(bundle.config, resolvedSkillPaths);
    warnings.push(...skillResult.warnings.map((w) => `[${bundle.config.name}] ${w}`));
    const skillsSection =
      bundle.config.skills && bundle.config.skills.length > 0
        ? { skills: bundle.config.skills, descriptions: skillResult.descriptions }
        : undefined;
    // First-pass body for validation — knowledge content is excluded so that
    // the assembled-body length budget still measures persona-authored prose.
    // (Knowledge config is validated separately inside `validate()`.)
    const validationBody = skillsSection
      ? assembleBody(bundle.files, skillsSection)
      : assembleBody(bundle.files);
    const validation = validate({
      config: bundle.config,
      files: bundle.files,
      assembledBody: validationBody,
    });
    if (!validation.ok) {
      errors.push({ agent: bundle.config.name, messages: validation.errors });
      continue;
    }
    warnings.push(...validation.warnings.map((w) => `[${bundle.config.name}] ${w}`));
    const mcpWarnings = await checkMcpAvailability(bundle.config, resolvedMcpPaths);
    if (mcpWarnings.length > 0 && !options.allowMissingMcp) {
      // v1-task B7: missing MCP servers are install-blocking by default.
      // The bundle declared an MCP requirement that the platform can't
      // satisfy; rendering the agent would produce a non-functional
      // install. Surface as an error with a per-target remediation hint
      // and the explicit opt-out flag, then skip this bundle.
      const remediated = mcpWarnings.map(
        (w) =>
          `${w}\n    fix: configure the server in the platform's MCP config (see 'smith doctor'), or re-run with --allow-missing-mcp`,
      );
      errors.push({ agent: bundle.config.name, messages: remediated });
      continue;
    }
    warnings.push(...mcpWarnings.map((w) => `[${bundle.config.name}] ${w}`));

    // Per-agent install lock: serializes CLI / daemon / GUI installs for the
    // same agent across processes. Skip-if-held semantics — report and move on.
    const installLock = await acquireInstallLock(
      resolvedKnowledgePaths.agentSmithHome,
      bundle.config.name,
    );
    if (!installLock) {
      errors.push({
        agent: bundle.config.name,
        messages: [
          `install: another install/refresh is in progress for '${bundle.config.name}'; retry in a moment`,
        ],
      });
      continue;
    }
    try {
      // Knowledge stage. Sidecar (`knowledge.json`) merges over the embedded
      // `config.knowledge` block; if any sources remain, run the pipeline to
      // materialize them under the canonical knowledge home.
      const mergedKnowledge = await loadAndMergeKnowledge(
        bundle.bundlePath,
        bundle.config.knowledge,
      );
      let knowledgeSection: KnowledgeSection | undefined;
      let knowledgeDir: string | undefined;
      let compiledKnowledge: CompiledKnowledge | undefined;
      if (mergedKnowledge && (mergedKnowledge.sources?.length ?? 0) > 0) {
        knowledgeDir = knowledgeDirFor(bundle.config.name, resolvedKnowledgePaths);
        const cacheDir = cacheDirFor(bundle.config.name, resolvedKnowledgePaths);

        // Capture the prior manifest snapshot BEFORE runKnowledgeStage overwrites
        // it. Critical ordering: if we read after runKnowledgeStage, we'd be
        // comparing the new manifest against itself and would falsely mark every
        // source unchanged. defaultReadPriorManifest swallows ENOENT (returns
        // null), so a first-time install just means "all sources changed".
        const priorManifestPath = join(knowledgeDir, "_manifest.json");
        const priorSnapshot = await defaultReadPriorManifest(priorManifestPath)();

        const stage = await runKnowledgeStage(mergedKnowledge, {
          bundleDir: bundle.bundlePath,
          knowledgeDir,
          cacheDir,
        });
        if (stage.errors.length > 0) {
          errors.push({
            agent: bundle.config.name,
            messages: stage.errors.map((e) => `knowledge: ${e}`),
          });
          continue;
        }
        warnings.push(...stage.warnings.map((w) => `[${bundle.config.name}/knowledge] ${w}`));
        knowledgeSection = stage.section;
        compiledKnowledge = stage.compiled;

        // Write per-source refresh-cache meta so the GUI surfaces a
        // lastRefreshAt immediately after install/render. Mirrors the
        // mergeCacheEntry+writeRefreshCache pattern used by
        // src/cli/commands/knowledge/{fetch,refresh-session-runner}.ts and
        // src/daemon/refresh-loop.ts. Failures degrade to warnings — a meta
        // write failure must NEVER fail an otherwise-successful install.
        const nowIso = new Date().toISOString();
        for (const src of stage.manifest.sources) {
          try {
            await writeRefreshCache(
              resolvedCacheRoot,
              bundle.config.name,
              src.id,
              mergeCacheEntry({ now: nowIso, outcome: { ok: true } }),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(
              `[${bundle.config.name}/knowledge] failed to write refresh-cache meta for ${src.id}: ${msg}`,
            );
          }
        }

        const summary = await summarizeKnowledgeStage({
          agent: bundle.config.name,
          currentManifest: stage.manifest,
          readPriorManifest: async () => priorSnapshot,
        });
        knowledge.push(summary);
      }

      // Final body: include knowledge section if the pipeline produced one.
      const body =
        knowledgeSection || skillsSection
          ? assembleBody(bundle.files, skillsSection, knowledgeSection, compiledKnowledge)
          : validationBody;

      // Knowledge-aware total-body length check on the FINAL rendered body.
      // The prose-only validate() above gates author intent; this guards
      // against oversized renders shipping silently when knowledge is wired in.
      const inlineBudgetTokens =
        mergedKnowledge?.inlineBudget?.totalTokens ?? DEFAULT_INLINE_BUDGET;
      const totalCheck = validateAssembledTotal(body, inlineBudgetTokens, bundle.config);
      if (!totalCheck.ok) {
        errors.push({ agent: bundle.config.name, messages: totalCheck.errors });
        continue;
      }
      warnings.push(...totalCheck.warnings.map((w) => `[${bundle.config.name}] ${w}`));

      const resolvedModels: Record<Target, string | undefined> = {
        opencode: undefined,
        "claude-code": undefined,
        codex: undefined,
        kiro: undefined,
        "agents-md": undefined,
      };
      // Targets that resolved successfully. If a per-target resolver throws
      // (unauthenticated, model-resolution-failed, etc.) or returns
      // undefined for a non-`inherit` tier, that target is skipped with a
      // warning rather than failing the entire bundle's install.
      const resolvedTargets: Target[] = [];
      for (const target of bundle.config.targets) {
        try {
          resolvedModels[target] = await RESOLVERS[target](bundle.config, modelEnv);
          resolvedTargets.push(target);
        } catch (err) {
          // PlatformUnavailableError = "user doesn't have this CLI". This
          // is not actionable — the user simply doesn't use this platform —
          // so the install drops the target silently. Doctor still reports
          // the platform's absence in its readiness matrix.
          if (err instanceof PlatformUnavailableError) {
            continue;
          }
          warnings.push(
            `[${bundle.config.name}/${target}] target skipped: ${formatResolverError(err)}`,
          );
        }
      }
      // If every declared target failed, fail the bundle instead of
      // emitting an empty install. Mirrors the prior "all-or-nothing"
      // behavior for the degenerate case where the user has no
      // authenticated platforms at all.
      if (resolvedTargets.length === 0) {
        errors.push({
          agent: bundle.config.name,
          messages: [
            `no targets resolvable: every declared target (${bundle.config.targets.join(", ")}) is unavailable (platform CLI not installed or model resolution failed). Install a target platform's CLI, set SMITH_<PLATFORM>_TIER_<TIER>, add a "model" to the bundle, or re-run with --allow-missing-cli to render anyway.`,
          ],
        });
        continue;
      }
      // Resolve platform conventions per declared target (Task 3.6).
      // Lazy-loaded to avoid pulling the user-prefs file unless any target
      // has a non-empty registry — most installs hit early returns.
      const { resolveConventions } = await import("../core/platform-conventions");
      const { loadConventions } = await import("./conventions");
      const userPrefs = await loadConventions().catch(() => null);
      const resolvedConventionUrisByTarget: Partial<Record<Target, string[]>> = {};
      for (const target of bundle.config.targets) {
        const r = await resolveConventions({
          target,
          bundleConfig: bundle.config,
          userPrefs,
          cliFlag: options.platformConventions,
          isTty: options.isTty ?? false,
          ...(options.promptForConventions
            ? { promptUser: options.promptForConventions }
            : {}),
        });
        resolvedConventionUrisByTarget[target] = r.uris;
      }
      // Render only for the targets that actually resolved. Cloning the
      // config with the filtered list keeps the original bundle data
      // immutable for the rest of the loop.
      const renderConfig =
        resolvedTargets.length === bundle.config.targets.length
          ? bundle.config
          : { ...bundle.config, targets: resolvedTargets };
      const rendered = renderForTargets(
        renderConfig,
        body,
        resolvedModels,
        knowledgeDir,
        options.withRefreshHooksFor?.get(bundle.config.name) === true,
        resolvedConventionUrisByTarget,
      );
      for (const r of rendered) {
        r.bundlePath = bundle.bundlePath;
        if (r.warnings && r.warnings.length > 0) {
          for (const w of r.warnings) {
            warnings.push(`[${bundle.config.name}/${r.target}] ${w}`);
          }
        }
      }
      allRendered.push(...rendered);

      // Bundle survived all per-bundle checks (validate, knowledge stage,
      // total-body check, model resolution, render). Only now record the
      // granted knowledge dir so the field reflects ACTUAL installs, matching
      // its JSDoc contract ("the install granted").
      if (knowledgeDir) {
        grantedKnowledgeDirs.push({ agent: bundle.config.name, dir: knowledgeDir });
      }
    } finally {
      await releaseRefreshLock(installLock);
    }
  }

  if (errors.length > 0) {
    // Abort-on-error: any per-bundle failure means NO installs proceed.
    // Safe because pipeline.ts uses atomic swap (tmp → rename) — the prior
    // knowledge dir is preserved bit-for-bit, and render targets keep their
    // previous successful state. Callers (fetch.ts, CLI) rely on this
    // contract to avoid writing misleading .meta.json entries.
    return { installed: [], skipped: [], warnings, errors, grantedKnowledgeDirs, knowledge };
  }
  const installResult = await installRendered(allRendered, paths, {
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.force === true ? { force: true } : {}),
  });
  return {
    installed: installResult.installed,
    skipped: installResult.skipped,
    warnings: [...warnings, ...installResult.warnings],
    errors: [],
    grantedKnowledgeDirs,
    knowledge,
  };
}

/**
 * Compact one-line summary of a resolver error suitable for the install
 * "target skipped: …" warning.
 *
 * For SmithError(model-resolution-failed), distill the multi-line `hint`
 * payload into a single actionable phrase. For anything else, fall back
 * to the first line of the error message.
 *
 * Why a dedicated helper: the prior code wrote
 * `target skipped: model resolution failed (model resolution failed for tier 'high').`
 * which repeated the prefix and dropped the actionable hint entirely.
 */
function formatResolverError(err: unknown): string {
  if (err instanceof SmithError && err.payload.code === "model-resolution-failed") {
    const tier = err.payload.tier;
    return `no model resolvable for tier '${tier}'. Run \`opencode auth login <provider>\` or set SMITH_TIER_${tier.toUpperCase()}.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0] ?? msg;
}
