/**
 * Render-only "dry run" of an agent bundle, used by the drift-check route to
 * compare what re-rendering NOW would produce against the contentHash stored
 * in `installed-agents.json`. No filesystem writes happen here — the result
 * is the per-target hash the installer would otherwise persist.
 *
 * Faithfulness: the chain is `loadBundle → assembleBody → renderForTargets →
 * serialize → hashContent`, the SAME helpers `installRendered` calls. If the
 * installer's serialization or hashing changes, drift-check follows
 * automatically (single source of truth).
 *
 * Limitations (acceptable for v1.9.1):
 *  - No knowledge stage / model resolution / platform-conventions resolution.
 *    Bundles that depend on those for their final bytes (tier resolution,
 *    inline knowledge, conventions) may report false drift on agents whose
 *    state is unchanged. The user resolves with a single Re-install click.
 *    A future iteration can re-route through a faithful dry-mode of the
 *    orchestrator if false-positive rates warrant it.
 */

import { join } from "node:path";
import type { Platform } from "gui-shared";
import { assembleBody } from "../../../../src/core/assembler";
import { renderForTargets } from "../../../../src/core/translators";
import type { AgentBundle, RenderedAgent, Source, Target } from "../../../../src/core/types";
import { loadBundle } from "../../../../src/io/bundle-loader";
import { hashContent } from "../../../../src/io/installed-agents";
import { serialize } from "../../../../src/io/installer";
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
    if (info.agents.includes(name)) {
      return { catalog, path: join(info.path, name) };
    }
  }
  return null;
}

export async function renderDryRun(input: DryRunInput, deps: DryRunDeps): Promise<DryRunOutput> {
  const parseReg = deps.parseRegistry ?? parseRegistry;
  const loader = deps.loadBundle ?? loadBundle;
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

  // Filter to only the targets the caller cares about (drift-check passes
  // the platforms the agent is actually installed on). When `targets` is
  // omitted, render everything the bundle declares — equivalent to a fresh
  // install's render set.
  const filterSet = input.targets ? new Set<Platform>(input.targets) : null;
  const renderTargets = filterSet
    ? bundle.config.targets.filter((t): t is Platform => isPlatform(t) && filterSet.has(t))
    : bundle.config.targets;

  if (renderTargets.length === 0) {
    return { hashes: [] };
  }

  // Match the same input shape `installRendered` consumes. Knowledge,
  // skills, and tier-resolved models are omitted intentionally — see file
  // header for rationale.
  const body = assembleBody(bundle.files);

  const resolvedModels: Record<Target, string | undefined> = {
    opencode: undefined,
    "claude-code": undefined,
    codex: undefined,
    kiro: undefined,
    "agents-md": undefined,
  };

  const renderConfig =
    renderTargets.length === bundle.config.targets.length
      ? bundle.config
      : { ...bundle.config, targets: renderTargets };

  const rendered: RenderedAgent[] = renderForTargets(renderConfig, body, resolvedModels);

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
