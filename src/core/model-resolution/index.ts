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
