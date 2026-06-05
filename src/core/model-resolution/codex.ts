// src/core/model-resolution/codex.ts
import { detectCodexAuth as defaultDetectCodexAuth } from "../../io/auth/codex";
import type { CanonicalConfig, CanonicalModelTier } from "../types";
import { PlatformUnavailableError } from "./types";
import type { ModelResolutionEnv } from "./types";

/**
 * Codex tier → model literal. Pinned to identifiers Codex's runtime
 * accepts as of 2026-05. Codex's model namespace is small and rarely
 * versioned, so a static table is sufficient — refresh per release if
 * OpenAI introduces new tiers.
 */
const TIER_TO_CODEX: Record<Exclude<CanonicalModelTier, "inherit">, string> = {
  high: "gpt-5-codex",
  balanced: "gpt-5",
  fast: "gpt-5-mini",
};

/**
 * Resolve a Codex model literal for a bundle's `modelTier`.
 *
 * Resolution order:
 *   1. `canonical.model` literal when the bundle targets codex.
 *   2. `SMITH_CODEX_TIER_<TIER>` env var.
 *   3. Auth detection: authenticated → static tier table.
 *   4. CLI not installed or unauthenticated → undefined + warning.
 */
export async function resolveCodexModel(
  canonical: CanonicalConfig,
  env: ModelResolutionEnv,
): Promise<string | undefined> {
  if (canonical.modelTier === "inherit") {
    // Inherit-tier means "use whatever the user has set as the default
    // for this platform." If the platform CLI isn't installed, there's
    // nothing to inherit from — refuse to render rather than emit a
    // file the user will never load.
    if (env.installed && !env.installed.has("codex")) {
      throw new PlatformUnavailableError("codex", "codex CLI not on PATH");
    }
    return undefined;
  }
  const tier = canonical.modelTier;

  // 1. Per-bundle model override (only when codex is actually a target).
  if (
    canonical.model !== undefined &&
    canonical.model.length > 0 &&
    canonical.targets.includes("codex")
  ) {
    return canonical.model;
  }

  // 2. Env override.
  const envSource = env.env ?? process.env;
  const envKey = `SMITH_CODEX_TIER_${tier.toUpperCase()}`;
  const envValue = envSource[envKey];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;

  // 3. Consult auth detector.
  const detect = env.detectCodexAuth ?? (() => defaultDetectCodexAuth());
  const auth = await detect();

  if (auth.status === "cli-not-installed") {
    if (env.allowMissingCli) {
      env.warnings.push({
        target: "codex",
        message:
          "codex CLI not installed; rendering tier '" + tier + "' as '" +
          TIER_TO_CODEX[tier] + "' (install the CLI or set SMITH_CODEX_TIER_" +
          tier.toUpperCase() + " to override).",
      });
      return TIER_TO_CODEX[tier];
    }
    throw new PlatformUnavailableError("codex", "codex CLI is not installed");
  }
  if (auth.status === "unauthenticated") {
    env.warnings.push({
      target: "codex",
      message:
        "Codex is unauthenticated for tier '" +
        tier +
        "'. Run `codex login`, set OPENAI_API_KEY, or set " +
        envKey +
        ".",
    });
    return undefined;
  }
  if (auth.status === "unknown") {
    env.warnings.push({
      target: "codex",
      message:
        "Codex auth state could not be determined; falling back to static tier mapping ('" +
        TIER_TO_CODEX[tier] +
        "').",
    });
    return TIER_TO_CODEX[tier];
  }

  // status === "authenticated"
  return TIER_TO_CODEX[tier];
}
