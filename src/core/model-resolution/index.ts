// src/core/model-resolution/index.ts
import type { CanonicalConfig, Target } from "../types";
import { resolveClaudeCodeModel } from "./claude-code";
import { resolveCodexModel } from "./codex";
import { resolveKiroModel } from "./kiro";
import { resolveOpenCodeModel } from "./opencode";
import type { ModelResolutionEnv } from "./types";

export type Resolver = (
  canonical: CanonicalConfig,
  env: ModelResolutionEnv,
) => Promise<string | undefined>;

export const RESOLVERS: Record<Target, Resolver> = {
  opencode: resolveOpenCodeModel,
  "claude-code": resolveClaudeCodeModel,
  codex: resolveCodexModel,
  kiro: resolveKiroModel,
  // AGENTS.md is a plain markdown contract — no model id is ever written
  // into the file, since the consuming tool (Cursor, Windsurf, Copilot,
  // etc.) picks its own model. Resolver returns undefined so no `model:`
  // ever flows downstream. The agents-md translator (T5b) will likewise
  // ignore any resolved model. This entry exists only to satisfy the
  // Record<Target, Resolver> exhaustiveness during the T5a widening.
  "agents-md": async () => undefined,
};

export {
  CURATED_FALLBACK_V0_6_0,
  type ModelResolutionEnv,
  TIER_PATTERNS,
  type WarningCollector,
  makeWarningCollector,
  type CuratedFallback,
} from "./types";
export { pickHighestVersion } from "./version-sort";
export { resolveOpenCodeModel } from "./opencode";
export { resolveClaudeCodeModel } from "./claude-code";
export { resolveCodexModel } from "./codex";
export { resolveKiroModel } from "./kiro";
