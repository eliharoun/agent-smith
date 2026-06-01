import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultInstallPaths } from "../cli/install-paths";
import type { LoadAllBundlesResult } from "../cli/load-all";
import { loadAllBundles as defaultLoadAllBundles } from "../cli/load-all";
import { assembleBody } from "../core/assembler";
import type { KnowledgeManifest, KnowledgeSection } from "../core/knowledge/types";
import { type ModelResolutionEnv, RESOLVERS } from "../core/model-resolution";
import { PlatformUnavailableError } from "../core/model-resolution/types";
import { renderForTargets } from "../core/translators";
import type { AgentBundle, InstallPaths, Target } from "../core/types";
import type { Registry } from "../io/registry";
import { canonicalRegistryPath, loadRegistry as defaultLoadRegistry } from "../io/registry";
import { installRendered as defaultInstallRendered } from "./installer";
import { knowledgeDirFor } from "./knowledge-paths";
import { getOpenCodeModels } from "./opencode-models";
import { detectAuthenticatedProviders } from "./opencode-auth";
import { deriveSkillSourceRoots } from "./orchestrator";
import { checkSkillAvailability } from "./skill-availability";

export interface RerenderPromptsDeps {
  agentSmithHome: string;
  installPaths?: InstallPaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  installRendered?: typeof defaultInstallRendered;
  modelResolutionEnv?: ModelResolutionEnv;
}

/**
 * Re-render and re-install prompts for a single agent from its existing
 * manifest + bundle. Does NOT re-acquire sources — render-only.
 */
export async function rerenderPrompts(
  agent: string,
  deps: RerenderPromptsDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    agentSmithHome,
    installPaths = defaultInstallPaths(),
    installRendered: doInstall = defaultInstallRendered,
  } = deps;
  const loadReg = deps.loadRegistry ?? ((p: string) => defaultLoadRegistry(p));
  const loadBundles = deps.loadAllBundles ?? ((r: Registry) => defaultLoadAllBundles(r));

  // 1. Load the bundle.
  let bundle: AgentBundle;
  try {
    const reg = await loadReg(canonicalRegistryPath());
    const result = await loadBundles(reg);
    const found = result.bundles.find((b) => b.config.name === agent);
    if (!found) {
      return { ok: false, error: `agent '${agent}' not found in registry` };
    }
    bundle = found;
  } catch (err) {
    return {
      ok: false,
      error: `failed to load bundle: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Read _manifest.json.
  const knowledgeDir = knowledgeDirFor(agent, { agentSmithHome });
  let manifest: KnowledgeManifest;
  try {
    const raw = await readFile(join(knowledgeDir, "_manifest.json"), "utf8");
    manifest = JSON.parse(raw) as KnowledgeManifest;
  } catch (err) {
    return {
      ok: false,
      error: `failed to read manifest: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Build KnowledgeSection from manifest (file-delivery index only).
  const knowledgeSection: KnowledgeSection = { inline: [], index: [], rootDir: knowledgeDir };
  for (const src of manifest.sources) {
    if (src.delivery === "inline") continue;
    for (const f of src.files) {
      knowledgeSection.index.push({
        id: src.id,
        relPath: f.path,
        ...(src.description ? { description: src.description } : {}),
        ...(f.summary ? { summary: f.summary } : {}),
      });
    }
  }
  knowledgeSection.hasGitSources = manifest.sources.some((s) => s.type === "git");
  knowledgeSection.sourceTypes = new Set(manifest.sources.map((s) => s.type));

  // 4. Assemble body.
  const skillSourceRoots = deriveSkillSourceRoots([bundle]);
  const skillPaths = {
    sourceRoots: skillSourceRoots,
    opencodeSkillsDir: join(homedir(), ".config/opencode/skills"),
    claudeSkillsDir: join(homedir(), ".claude/skills"),
    codexSkillsDir: join(homedir(), ".agents/skills"),
  };
  const skillResult = await checkSkillAvailability(bundle.config, skillPaths);
  const skillsSection =
    bundle.config.skills && bundle.config.skills.length > 0
      ? { skills: bundle.config.skills, descriptions: skillResult.descriptions }
      : undefined;

  const hasKnowledge = knowledgeSection.index.length > 0;
  const body = assembleBody(
    bundle.files,
    skillsSection,
    hasKnowledge ? knowledgeSection : undefined,
  );

  // 5. Resolve models + render for targets.
  const warnings: string[] = [];
  const modelEnv: ModelResolutionEnv = deps.modelResolutionEnv ?? {
    getOpenCodeModels:
      process.env.AGENT_SMITH_DISABLE_LIVE_RESOLUTION === "1"
        ? async () => undefined
        : getOpenCodeModels,
    warnings: {
      push(w) {
        warnings.push(`[${agent}/${w.target}] ${w.message}`);
      },
    },
    detectAuthenticatedProviders: async () => detectAuthenticatedProviders(),
    env: process.env,
  };

  const resolvedModels: Record<Target, string | undefined> = {
    opencode: undefined,
    "claude-code": undefined,
    codex: undefined,
    kiro: undefined,
    "agents-md": undefined,
  };
  // Per-target resolution mirrors the orchestrator (src/io/orchestrator.ts):
  // a single target's model-resolution failure should NOT take down the
  // whole rerender. Knowledge-fetch was the user-visible site of this
  // bug — fetching knowledge for an agent installed only on claude-code
  // crashed because the OpenCode resolver threw (no providers
  // authenticated for tier 'high') even though OpenCode wasn't actually
  // a target the user cared about. PlatformUnavailableError is silently
  // skipped (CLI not installed = "user doesn't use this platform").
  // Other resolution errors collect a warning and the target is dropped
  // from the rerender.
  const resolvedTargets: Target[] = [];
  for (const target of bundle.config.targets) {
    try {
      resolvedModels[target] = await RESOLVERS[target](bundle.config, modelEnv);
      resolvedTargets.push(target);
    } catch (err) {
      if (err instanceof PlatformUnavailableError) continue;
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      warnings.push(`[${agent}/${target}] target skipped during rerender: ${msg}`);
    }
  }
  if (resolvedTargets.length === 0) {
    return {
      ok: false,
      error: `no targets resolvable for ${agent}: every declared target failed model resolution. Authenticate at least one platform.`,
    };
  }

  // Render only for the targets that resolved. Cloning the config keeps
  // the original bundle data immutable for any later consumer.
  const renderConfig =
    resolvedTargets.length === bundle.config.targets.length
      ? bundle.config
      : { ...bundle.config, targets: resolvedTargets };
  const rendered = renderForTargets(
    renderConfig,
    body,
    resolvedModels,
    hasKnowledge ? knowledgeDir : undefined,
    false,
  );

  // 6. Install rendered.
  await doInstall(rendered, installPaths);
  return { ok: true };
}
