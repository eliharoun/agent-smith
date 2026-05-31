// src/core/model-resolution/claude-code.ts
import { detectClaudeCodeAuth as defaultDetectClaudeCodeAuth } from "../../io/auth/claude-code";
import type { CanonicalConfig, CanonicalModelTier } from "../types";
import { PlatformUnavailableError } from "./types";
import type { ModelResolutionEnv } from "./types";

/**
 * Claude Code's legacy tier names. When `availableModels` is unknown
 * (e.g. the user has the CLI but smith couldn't read settings.json), we
 * emit these literals — Claude Code's runtime maps them to the latest
 * model in each family on its own.
 */
const LEGACY_TIER_NAMES: Record<Exclude<CanonicalModelTier, "inherit">, string> = {
  high: "opus",
  balanced: "sonnet",
  fast: "haiku",
};

/**
 * Tier-specific substitution preference when the literal name (e.g. `haiku`)
 * is missing from `availableModels`. Order: closest tier above first, then
 * any remaining model.
 *
 * Why: Claude Code's bedrock-backed installs may expose only opus+sonnet;
 * a bundle requesting `fast` should still install successfully but with a
 * clearly-warned substitution rather than a silent failure.
 */
const SUBSTITUTION_ORDER: Record<Exclude<CanonicalModelTier, "inherit">, string[]> = {
  high: ["opus", "sonnet", "haiku"],
  balanced: ["sonnet", "opus", "haiku"],
  fast: ["haiku", "sonnet", "opus"],
};

/**
 * Resolve a Claude Code model literal for a bundle's `modelTier`.
 *
 * Resolution order (first match wins):
 *   1. `canonical.model` literal (escape hatch for advanced users).
 *   2. `SMITH_CLAUDE_TIER_<TIER>` env var.
 *   3. Auth detection: if `availableModels` is reported, prefer the
 *      legacy tier name when present, else substitute the closest
 *      available family (with a warning).
 *   4. Auth detection: authenticated but `availableModels` unknown →
 *      emit the legacy tier name. Claude Code resolves it natively.
 *   5. CLI not installed or unauthenticated → return undefined and
 *      emit a warning. The installer treats `undefined` as a per-target
 *      failure.
 */
export async function resolveClaudeCodeModel(
  canonical: CanonicalConfig,
  env: ModelResolutionEnv,
): Promise<string | undefined> {
  if (canonical.modelTier === "inherit") return undefined;
  const tier = canonical.modelTier;

  // 1. Per-bundle model override
  if (canonical.model && canonical.model.length > 0) return canonical.model;

  // 2. Env override
  const envSource = env.env ?? process.env;
  const envKey = `SMITH_CLAUDE_TIER_${tier.toUpperCase()}`;
  const envValue = envSource[envKey];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;

  // 3-5: Consult auth detector
  const detect = env.detectClaudeCodeAuth ?? (() => defaultDetectClaudeCodeAuth());
  const auth = await detect();

  if (auth.status === "cli-not-installed") {
    if (env.allowMissingCli) {
      env.warnings.push({
        target: "claude-code",
        message:
          "claude CLI not installed; rendering tier '" + tier + "' as '" +
          LEGACY_TIER_NAMES[tier] + "' (install the CLI or set SMITH_CLAUDE_TIER_" +
          tier.toUpperCase() + " to override).",
      });
      return LEGACY_TIER_NAMES[tier];
    }
    throw new PlatformUnavailableError("claude-code", "claude CLI is not installed");
  }
  if (auth.status === "unauthenticated") {
    env.warnings.push({
      target: "claude-code",
      message:
        "Claude Code is unauthenticated for tier '" +
        tier +
        "'. Run `claude auth login` or set " +
        envKey +
        ".",
    });
    return undefined;
  }
  if (auth.status === "unknown") {
    env.warnings.push({
      target: "claude-code",
      message:
        "Claude Code auth state could not be determined; falling back to legacy tier name '" +
        LEGACY_TIER_NAMES[tier] +
        "'.",
    });
    return LEGACY_TIER_NAMES[tier];
  }

  // status === "authenticated"
  const available = auth.availableModels;
  if (!available || available.length === 0) {
    // No model list — Claude Code resolves tier names natively.
    return LEGACY_TIER_NAMES[tier];
  }

  // Try the literal tier name first.
  const preferredName = LEGACY_TIER_NAMES[tier];
  if (available.includes(preferredName)) return preferredName;

  // Fall back to substitution order.
  for (const candidate of SUBSTITUTION_ORDER[tier]) {
    if (available.includes(candidate)) {
      env.warnings.push({
        target: "claude-code",
        message:
          "tier '" +
          tier +
          "' substituted with '" +
          candidate +
          "' (" +
          preferredName +
          " not in your authenticated model list: [" +
          available.join(", ") +
          "]).",
      });
      return candidate;
    }
  }

  // Couldn't even substitute. Emit the literal anyway and warn loudly.
  env.warnings.push({
    target: "claude-code",
    message:
      "tier '" +
      tier +
      "' could not be resolved from your model list [" +
      available.join(", ") +
      "]; emitting '" +
      preferredName +
      "' which Claude Code's runtime may reject.",
  });
  return preferredName;
}
