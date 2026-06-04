import type { CanonicalConfig, RenderedAgent, ResolvedModelContext, Target } from "../types";
import {
  injectKnowledgeIntoRender,
  injectPlatformConventions,
} from "../knowledge/permission-grant";
import { translateAgentsMd } from "./agents-md";
import { translateClaudeCode } from "./claude-code";
import { translateCodex } from "./codex";
import { translateKiro } from "./kiro";
import { translateOpenCode } from "./opencode";

export interface RenderContext extends ResolvedModelContext {
  /** Absolute path to the per-agent knowledge dir, if knowledge sources exist. */
  knowledgeDir?: string;
}

const TRANSLATORS: Record<
  Target,
  (config: CanonicalConfig, body: string, ctx: RenderContext) => RenderedAgent
> = {
  opencode: translateOpenCode,
  "claude-code": translateClaudeCode,
  codex: translateCodex,
  kiro: translateKiro,
  "agents-md": translateAgentsMd,
};

/**
 * Render a canonical bundle for each declared target.
 * `resolvedModels` maps each target to its pre-resolved model (or undefined
 * if no `model:` line should be written).
 *
 * `withRefreshHooks` (default false) gates emission of refresh-hook
 * frontmatter blocks. Only callers that have obtained explicit user
 * consent (currently the install CLI) should pass `true`. See
 * `ResolvedModelContext.withRefreshHooks` for rationale.
 */
export function renderForTargets(
  config: CanonicalConfig,
  body: string,
  resolvedModels: Record<Target, string | undefined>,
  knowledgeDir?: string,
  withRefreshHooks?: boolean,
  resolvedConventionUrisByTarget?: Partial<Record<Target, readonly string[]>>,
  bodyOverrides?: Partial<Record<Target, string>>,
): RenderedAgent[] {
  return config.targets.map((target) => {
    const ctx: RenderContext = {
      resolvedModel: resolvedModels[target],
      ...(knowledgeDir ? { knowledgeDir } : {}),
      ...(withRefreshHooks === true ? { withRefreshHooks: true } : {}),
    };
    const targetBody = bodyOverrides?.[target] ?? body;
    let rendered = TRANSLATORS[target](config, targetBody, ctx);
    rendered = injectKnowledgeIntoRender(rendered, knowledgeDir);
    rendered = injectPlatformConventions(
      rendered,
      resolvedConventionUrisByTarget?.[target] ?? [],
    );
    return rendered;
  });
}

export {
  translateAgentsMd,
  translateClaudeCode,
  translateCodex,
  translateKiro,
  translateOpenCode,
};
