// src/core/model-resolution/kiro.ts
//
// Kiro tier resolution. Honors SMITH_KIRO_TIER_<TIER> env overrides and
// the per-bundle `model` field, then falls back to a static tier table.
// Tier values match Kiro's chat model namespace as of 2026-05.
//
// Auth gating (new): if kiro-cli is unauthenticated or not installed,
// resolution returns undefined with a warning. Lets the installer skip
// kiro cleanly when the user has the CLI but no AWS SSO session, instead
// of emitting a kiro agent file with a model the runtime will reject.

import { detectKiroAuth as defaultDetectKiroAuth } from "../../io/auth/kiro";
import type { CanonicalConfig, CanonicalModelTier } from "../types";
import { PlatformUnavailableError } from "./types";
import type { ModelResolutionEnv } from "./types";

const TIER_TO_KIRO: Record<Exclude<CanonicalModelTier, "inherit">, string> = {
  high: "claude-opus-4.6",
  balanced: "claude-sonnet-4.6",
  fast: "claude-haiku-4.5",
};

export async function resolveKiroModel(
  canonical: CanonicalConfig,
  env: ModelResolutionEnv,
): Promise<string | undefined> {
  if (canonical.modelTier === "inherit") return undefined;
  const tier = canonical.modelTier;

  // 1. Per-bundle model override (only when kiro is actually a target).
  if (canonical.model !== undefined && canonical.targets.includes("kiro")) {
    return canonical.model;
  }

  // 2. Env override.
  const envSource = env.env ?? process.env;
  const envKey = `SMITH_KIRO_TIER_${tier.toUpperCase()}`;
  const envValue = envSource[envKey];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;

  // 3. Consult auth detector.
  const detect = env.detectKiroAuth ?? (() => defaultDetectKiroAuth());
  const auth = await detect();

  if (auth.status === "cli-not-installed") {
    throw new PlatformUnavailableError("kiro", "kiro-cli is not installed");
  }
  if (auth.status === "unauthenticated") {
    env.warnings.push({
      target: "kiro",
      message:
        "Kiro is unauthenticated for tier '" +
        tier +
        "'. Run `kiro-cli login` or set " +
        envKey +
        ".",
    });
    return undefined;
  }
  if (auth.status === "unknown") {
    env.warnings.push({
      target: "kiro",
      message:
        "Kiro auth state could not be determined; falling back to static tier mapping ('" +
        TIER_TO_KIRO[tier] +
        "').",
    });
    return TIER_TO_KIRO[tier];
  }

  // status === "authenticated"
  return TIER_TO_KIRO[tier];
}
