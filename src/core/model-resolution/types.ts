// src/core/model-resolution/types.ts

import type { PlatformAuth } from "../../io/auth/types";
import type { CanonicalModelTier } from "../types";

/** Sink for warnings emitted during resolution. Matches existing translator/orchestrator warning style. */
export interface WarningCollector {
  push(warning: { target: string; message: string }): void;
}

/** Curated fallback literals pinned per release. Used by `smith doctor` for drift detection. */
export interface CuratedFallback {
  high: string;
  balanced: string;
  fast: string;
}

/** Pinned curated fallback for v0.6.0. Used by `smith doctor` drift detection only. */
export const CURATED_FALLBACK_V0_6_0: CuratedFallback = {
  high: "github-copilot/claude-opus-4.7",
  balanced: "github-copilot/claude-sonnet-4.6",
  fast: "github-copilot/claude-haiku-4.5",
} as const;

/** Tier -> regex matched against entries from `opencode models`. */
export const TIER_PATTERNS: Record<Exclude<CanonicalModelTier, "inherit">, RegExp> = {
  high: /claude-opus-/i,
  balanced: /claude-sonnet-/i,
  fast: /claude-haiku-/i,
} as const;

/** Injected dependencies. Tests pass a fake; production wires real impls. */
export interface ModelResolutionEnv {
  /**
   * Lazily fetches the OpenCode model list. Memoized within a single
   * process invocation by the production implementation. Returns undefined
   * if the CLI is absent or the query fails for any reason.
   */
  getOpenCodeModels: () => Promise<string[] | undefined>;
  warnings: WarningCollector;
  /**
   * Optional: detect authenticated OpenCode providers. Used only by the
   * OpenCode resolver; defaults to opencode-auth.detectAuthenticatedProviders.
   */
  detectAuthenticatedProviders?: () => Promise<string[]>;
  /**
   * Optional: per-platform auth detectors. Each defaults to its
   * corresponding implementation in `src/io/auth/`. Tests inject fakes to
   * exercise resolution without touching the filesystem.
   */
  detectClaudeCodeAuth?: () => Promise<PlatformAuth>;
  detectCodexAuth?: () => Promise<PlatformAuth>;
  detectKiroAuth?: () => Promise<PlatformAuth>;
  /**
   * When true, a resolver whose platform CLI is absent returns the static
   * tier literal + a warning instead of throwing PlatformUnavailableError.
   * Wired from `smith agent install --allow-missing-cli`. Default: throw.
   */
  allowMissingCli?: boolean;
  /** Optional: read process env. Test seam. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Thrown by a platform's resolver when the platform's CLI isn't installed
 * on the user's machine. Distinct from auth failures: a missing CLI is
 * something the user may legitimately not need (they just don't use that
 * platform), so the orchestrator catches this error and silently drops
 * the target without surfacing a warning. Auth failures, by contrast,
 * stay loud — those are typically what the user wants to fix.
 */
export class PlatformUnavailableError extends Error {
  readonly target: string;
  constructor(target: string, message: string) {
    super(message);
    this.target = target;
    this.name = "PlatformUnavailableError";
  }
}

/** Production helper: simple array-backed warning collector. */
export function makeWarningCollector(): WarningCollector & {
  warnings: Array<{ target: string; message: string }>;
} {
  const warnings: Array<{ target: string; message: string }> = [];
  return {
    warnings,
    push(w) {
      warnings.push(w);
    },
  };
}
