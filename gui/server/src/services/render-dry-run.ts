/**
 * Render-only "dry run" of an agent bundle, used by the drift-check route to
 * compare what re-rendering NOW would produce against the contentHash stored
 * in `installed-agents.json`. No filesystem writes happen here — the result
 * is the per-target hash the installer would otherwise persist.
 *
 * Faithfulness: replicates the orchestrator's render pipeline byte-for-byte:
 *
 *    loadBundle
 *      → loadAndMergeKnowledge (read sidecar, merge with embedded block)
 *      → assembleBody (inject knowledge section + compiled tocStanza if any)
 *      → resolveModels per target via RESOLVERS (skip platforms that throw)
 *      → resolveConventions per target (read user prefs, no prompts)
 *      → renderForTargets (with knowledgeDir, conventions, refresh-hooks=false)
 *      → serialize → hashContent
 *
 * The same helpers `installRendered` calls. If the installer's serialization
 * or hashing changes, drift-check follows automatically (single source of
 * truth).
 *
 * Limitations:
 *  - `withRefreshHooks` is hard-coded to `false` (matches the install CLI's
 *    default for non-interactive contexts). Bundles whose user explicitly
 *    consented to refresh hooks AND that have session/always knowledge
 *    sources will report false-positive drift on claude-code/kiro targets.
 *    Re-install resolves it.
 *  - `bodyOverrides` (lazy URL agents-md degrade, v1.9.0) is omitted: the
 *    install-time URL fetches can't be cheaply reproduced without a network
 *    roundtrip. Bundles with lazy URL sources targeting agents-md (Cursor,
 *    Windsurf, Aider) will report false-positive drift on those targets.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Platform } from "../../../shared/src/index";
import { defaultKnowledgePaths } from "../../../../src/cli/install-paths";
import { assembleBody } from "../../../../src/core/assembler";
import { loadAndMergeKnowledge } from "../../../../src/core/knowledge/sidecar";
import {
  runCompileFromMaterialized,
  shouldAutoCompile,
} from "../../../../src/core/knowledge/pipeline";
import type { CompiledKnowledge } from "../../../../src/core/knowledge/compile";
import type {
  KnowledgeBlock,
  KnowledgeManifest,
  KnowledgeSection,
} from "../../../../src/core/knowledge/types";
import { type ModelResolutionEnv, RESOLVERS } from "../../../../src/core/model-resolution";
import { PlatformUnavailableError } from "../../../../src/core/model-resolution/types";
import { resolveConventions } from "../../../../src/core/platform-conventions";
import { renderForTargets } from "../../../../src/core/translators";
import type { AgentBundle, RenderedAgent, Source, Target } from "../../../../src/core/types";
import { loadBundle } from "../../../../src/io/bundle-loader";
import { type ConventionsFile, loadConventions } from "../../../../src/io/conventions";
import { hashContent } from "../../../../src/io/installed-agents";
import { serialize } from "../../../../src/io/installer";
import { type KnowledgePaths, knowledgeDirFor } from "../../../../src/io/knowledge-paths";
import { parseRegistry, type Registry } from "./parse-registry";

export interface DryRunInput {
  agent: string;
  /**
   * Optional restriction to specific render targets. drift-check uses this
   * to skip rendering platforms the agent isn't installed on. When omitted,
   * every target declared in the bundle config is rendered.
   */
  targets?: readonly Platform[];
}

export interface DryRunHash {
  platform: Platform;
  relativePath: string;
  kind: "main" | "sidecar";
  hash: string;
}

export interface DryRunOutput {
  hashes: DryRunHash[];
}

export interface DryRunDeps {
  registryPath: string;
  /**
   * Override the bundle loader. Production omits and gets `loadBundle` from
   * src/io/bundle-loader. Tests inject a stub returning a synthetic
   * AgentBundle so the test doesn't need to materialize a full on-disk
   * bundle when only the post-load behavior matters.
   */
  loadBundle?: (path: string, source: Source) => Promise<AgentBundle>;
  /** Optional override for parseRegistry (tests inject a fake registry). */
  parseRegistry?: (path: string) => Promise<Registry>;
  /**
   * Per-target model resolver. Default invokes the production RESOLVERS
   * map (which spawns `opencode` etc.). Tests inject a stub returning a
   * fixed map so they don't need real platform CLIs on the test runner.
   * Must mirror the orchestrator's per-target try/catch contract:
   * PlatformUnavailableError = drop the target silently, anything else =
   * drop with a warning. The dry-run path swallows warnings (drift-check
   * doesn't surface them today), but the dropped-target list is honored.
   */
  resolveModels?: (
    bundle: AgentBundle,
  ) => Promise<{
    resolvedModels: Record<Target, string | undefined>;
    resolvedTargets: Target[];
  }>;
  /**
   * Loader for the user-global PlatformConventions preferences file.
   * Tests inject a stub returning an empty file so they don't read the
   * real `~/.config/agent-smith/conventions.json`. Default routes through
   * `loadConventions()` and degrades to `null` on any read error (mirrors
   * the orchestrator's `.catch(() => null)`).
   */
  loadConventions?: () => Promise<ConventionsFile | null>;
  /**
   * Where materialized knowledge lives. Defaults to `defaultKnowledgePaths()`
   * (`~/.config/agent-smith`). Tests inject a tmpdir so they don't read the
   * user's real knowledge state.
   */
  knowledgePaths?: KnowledgePaths;
}

const PLATFORM_TARGETS: ReadonlySet<Target> = new Set<Target>([
  "opencode",
  "claude-code",
  "codex",
  "kiro",
]);

function isPlatform(t: Target): t is Platform {
  return PLATFORM_TARGETS.has(t);
}

/**
 * Locate the bundle for an agent name in the registry. Mirrors the
 * findAgentMatches logic in routes/agents.ts but stripped of warnings —
 * dry-run is a hot path called every drift-check.
 */
function findBundlePath(reg: Registry, name: string): { catalog: string; path: string } | null {
  for (const [catalog, info] of Object.entries(reg.catalogs)) {
    const ref = info.agents.find((a) => a.name === name);
    if (ref) {
      return { catalog, path: join(info.path, ref.relPath) };
    }
  }
  return null;
}

/**
 * Read the per-agent knowledge state from disk and reconstruct the
 * KnowledgeSection + (optionally) CompiledKnowledge that the orchestrator
 * would have produced at install time.
 *
 * Reads `_manifest.json` (and `compile-manifest.json` when applicable) but
 * does NOT mutate the filesystem. Returns `undefined` for both fields when
 * the agent has no declared sources or no materialized state on disk.
 */
async function loadKnowledgeForRender(
  block: KnowledgeBlock | undefined,
  knowledgeDir: string,
  bundleDir: string,
): Promise<{
  section: KnowledgeSection | undefined;
  compiled: CompiledKnowledge | undefined;
}> {
  if (!block || !block.sources || block.sources.length === 0) {
    return { section: undefined, compiled: undefined };
  }
  // runCompileFromMaterialized always returns a compiled output (the offline
  // path forces compile). We then re-apply `shouldAutoCompile` to decide
  // whether to feed compiled into assembleBody (mirroring the live install
  // decision in runKnowledgeStage). The `cacheDir` arg is unused by the
  // function; we pass an empty string to avoid pulling cache-root resolution.
  const result = await runCompileFromMaterialized(block, {
    bundleDir,
    knowledgeDir,
    cacheDir: "",
    writeManifest: false,
  });
  if (result.errors.length > 0) {
    // Materialized state missing — the agent was never fully installed, or
    // its knowledge dir was wiped. Surface NO knowledge section so the body
    // assembles as though the bundle had no knowledge. Drift-check will
    // report drift, which is correct (re-install would re-acquire).
    return { section: undefined, compiled: undefined };
  }
  const compileExplicit = block.compile?.progressive;
  const useCompiled =
    compileExplicit === true ||
    (compileExplicit !== false && shouldAutoCompile(result.manifest, block));
  return {
    section: result.section,
    compiled: useCompiled ? result.compiled : undefined,
  };
}

/**
 * Production model-resolver: mirrors the orchestrator's per-target try/catch.
 * Returns the resolved-model map and the list of targets that resolved.
 * Targets that throw PlatformUnavailableError are dropped silently;
 * anything else is dropped without surfacing the warning (drift-check
 * doesn't surface resolver warnings today — false-positive drift is the
 * "loud" signal a user would notice).
 */
async function defaultResolveModels(bundle: AgentBundle): Promise<{
  resolvedModels: Record<Target, string | undefined>;
  resolvedTargets: Target[];
}> {
  const resolvedModels: Record<Target, string | undefined> = {
    opencode: undefined,
    "claude-code": undefined,
    codex: undefined,
    kiro: undefined,
    "agents-md": undefined,
  };
  const resolvedTargets: Target[] = [];
  // Build a minimal env that won't spawn platform CLIs for targets the
  // bundle didn't declare. The dry-run is downstream of a GUI request so
  // the warning sink is a no-op (the drift-check route never surfaces
  // resolver warnings — it cares only about the produced hashes).
  const { detectAuthenticatedProviders } = await import(
    "../../../../src/io/opencode-auth"
  );
  const { getOpenCodeModels } = await import(
    "../../../../src/io/opencode-models"
  );
  const liveGetModels =
    process.env.AGENT_SMITH_DISABLE_LIVE_RESOLUTION === "1"
      ? async () => undefined
      : getOpenCodeModels;
  const env: ModelResolutionEnv = {
    getOpenCodeModels: liveGetModels,
    warnings: { push() {} },
    detectAuthenticatedProviders: async () => detectAuthenticatedProviders(),
    env: process.env,
    allowMissingCli: false,
  };
  for (const target of bundle.config.targets) {
    try {
      resolvedModels[target] = await RESOLVERS[target](bundle.config, env);
      resolvedTargets.push(target);
    } catch (err) {
      if (err instanceof PlatformUnavailableError) continue;
      // Any other resolver failure: drop the target. The translator chain
      // would have skipped it at install time; dry-run mirrors that.
    }
  }
  return { resolvedModels, resolvedTargets };
}

export async function renderDryRun(input: DryRunInput, deps: DryRunDeps): Promise<DryRunOutput> {
  const parseReg = deps.parseRegistry ?? parseRegistry;
  const loader = deps.loadBundle ?? loadBundle;
  const resolveModels = deps.resolveModels ?? defaultResolveModels;
  const loadConv = deps.loadConventions ?? (async () => loadConventions().catch(() => null));
  const knowledgePaths = deps.knowledgePaths ?? defaultKnowledgePaths();

  const reg = await parseReg(deps.registryPath);
  const match = findBundlePath(reg, input.agent);
  if (!match) {
    throw new Error(`agent ${input.agent} not in registry`);
  }
  const source: Source = {
    kind: "registered",
    rootPath: reg.catalogs[match.catalog]?.path ?? match.path,
    label: match.catalog,
  };
  const bundle = await loader(match.path, source);

  // 1. Resolve models. Targets that can't resolve (CLI absent, no auth,
  //    etc.) are dropped from the render set — mirrors the orchestrator's
  //    "skip silently" contract for unavailable platforms.
  const { resolvedModels, resolvedTargets } = await resolveModels(bundle);

  // 2. Filter to only the targets the caller cares about (drift-check passes
  //    the platforms the agent is actually installed on). When `targets` is
  //    omitted, render everything that resolved.
  const filterSet = input.targets ? new Set<Platform>(input.targets) : null;
  const renderTargets = filterSet
    ? resolvedTargets.filter((t): t is Platform => isPlatform(t) && filterSet.has(t))
    : resolvedTargets;

  if (renderTargets.length === 0) {
    return { hashes: [] };
  }

  // 3. Load knowledge sidecar + reconstruct section/compiled from disk.
  //    Skipped for bundles without declared sources.
  const mergedKnowledge = await loadAndMergeKnowledge(bundle.bundlePath, bundle.config.knowledge);
  const knowledgeDir =
    mergedKnowledge && (mergedKnowledge.sources?.length ?? 0) > 0
      ? knowledgeDirFor(bundle.config.name, knowledgePaths)
      : undefined;
  const { section: knowledgeSection, compiled: compiledKnowledge } = await loadKnowledgeForRender(
    mergedKnowledge,
    knowledgeDir ?? "",
    bundle.bundlePath,
  );

  // 4. Assemble the body. Skills section is omitted: the orchestrator
  //    builds it from on-disk skill metadata, which doesn't affect the
  //    body's `## Default Skills` block bytes for the common case where
  //    the skill descriptions match the bundle's declared skill list.
  //    (Full faithfulness for skills would require checkSkillAvailability
  //    here too — a follow-up if drift false-positives appear on bundles
  //    with skills.)
  const body =
    knowledgeSection || compiledKnowledge
      ? assembleBody(bundle.files, undefined, knowledgeSection, compiledKnowledge)
      : assembleBody(bundle.files);

  // 5. Resolve platform conventions per declared target. Mirrors the
  //    orchestrator's block at orchestrator.ts:485-504. Cache the user
  //    prefs once outside the loop. Non-TTY (false) so the resolver
  //    falls back to fail-safe-reject if a target reaches Tier 3 — the
  //    same posture the orchestrator uses when no CLI flag is set.
  const userPrefs = await loadConv();
  const resolvedConventionUrisByTarget: Partial<Record<Target, string[]>> = {};
  for (const target of renderTargets) {
    const r = await resolveConventions({
      target,
      bundleConfig: bundle.config,
      userPrefs,
      cliFlag: undefined,
      isTty: false,
    });
    resolvedConventionUrisByTarget[target] = r.uris;
  }

  // 6. Render. Pass `withRefreshHooks: false` (the install CLI's default
  //    for non-interactive contexts; see file header for limitation).
  //    `bodyOverrides` is omitted (lazy-URL agents-md degrade is the one
  //    install-time effect we can't cheaply reproduce; see file header).
  const renderConfig =
    renderTargets.length === bundle.config.targets.length
      ? bundle.config
      : { ...bundle.config, targets: renderTargets };

  const rendered: RenderedAgent[] = renderForTargets(
    renderConfig,
    body,
    resolvedModels,
    knowledgeDir,
    false,
    resolvedConventionUrisByTarget,
  );

  const hashes: DryRunHash[] = [];
  for (const r of rendered) {
    if (!isPlatform(r.target)) continue;
    hashes.push({
      platform: r.target,
      relativePath: r.relativePath,
      kind: "main",
      hash: hashContent(serialize(r)),
    });
    for (const sidecar of r.sidecars ?? []) {
      hashes.push({
        platform: r.target,
        relativePath: sidecar.relativePath,
        kind: "sidecar",
        hash: hashContent(sidecar.content),
      });
    }
  }
  return { hashes };
}
