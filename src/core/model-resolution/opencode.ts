// src/core/model-resolution/opencode.ts
import { detectOpenCodeAuth as defaultDetectOpenCodeAuth } from "../../io/auth/opencode";
import type { CanonicalConfig, CanonicalModelTier } from "../types";
import { SmithError } from "../smith-error";
import { PROVIDER_TABLE_V1_0_0_RC_5, sortByOpenCodePrecedence } from "./provider-table";
import { PlatformUnavailableError, type ModelResolutionEnv } from "./types";
import { pickHighestVersion } from "./version-sort";

/**
 * Curated tier → canonical-id mapping used when the OpenCode CLI is absent
 * AND `--allow-missing-cli` is set. Matches the highest-precedence
 * github-copilot entry from PROVIDER_TABLE_V1_0_0_RC_5 — OpenCode's
 * default-best provider — so headless / hermetic CI flows render a
 * predictable model literal even without the CLI installed.
 *
 * This is the same shape as `LEGACY_TIER_NAMES` (claude-code) and
 * `TIER_TO_CODEX` (codex): one entry per non-`inherit` tier, used only on
 * the `cli-not-installed + allowMissingCli` branch.
 */
const TIER_TO_OPENCODE: Record<Exclude<CanonicalModelTier, "inherit">, string> = {
  high: "github-copilot/claude-opus-4.7",
  balanced: "github-copilot/claude-sonnet-4.6",
  fast: "github-copilot/claude-haiku-4.5-thinking-fast",
};

/**
 * Resolve the OpenCode `model` literal at install time.
 *
 * Layered resolution (Phase 3):
 *   1. Explicit `canonical.model` override → verbatim.
 *   2. `canonical.modelTier === "inherit"` → undefined.
 *   3. SMITH_TIER_<TIER> env override → verbatim (warn if not in live list).
 *   4. Walk preferred providers against live model list.
 *   5. Curated fallback chain.
 *   6. Fail loudly with actionable SmithError.
 */
export async function resolveOpenCodeModel(
  canonical: CanonicalConfig,
  env: ModelResolutionEnv,
): Promise<string | undefined> {
  // 1. Explicit override wins.
  if (canonical.model !== undefined) return canonical.model;

  // 2. inherit → no model line.
  if (canonical.modelTier === "inherit" || canonical.modelTier === undefined) return undefined;

  const tier = canonical.modelTier;

  // 3. Env override.
  const processEnv = env.env ?? process.env;
  const envKey = `SMITH_TIER_${tier.toUpperCase()}`;
  const envOverride = processEnv[envKey];
  if (envOverride) {
    const live = await env.getOpenCodeModels();
    if (live && !live.includes(envOverride)) {
      env.warnings.push({
        target: "opencode",
        message: `${envKey}='${envOverride}' not found in live model list; using it verbatim.`,
      });
    }
    return envOverride;
  }

  // 4. Resolve provider preferences.
  const preferences = await resolveProviderPreferences(env);

  // 5. Live resolution.
  const live = await env.getOpenCodeModels();

  // Step 7: Walk providers against live list.
  if (live) {
    for (const provider of preferences) {
      const entry =
        PROVIDER_TABLE_V1_0_0_RC_5[tier][
          provider as keyof (typeof PROVIDER_TABLE_V1_0_0_RC_5)[typeof tier]
        ];
      if (!entry) continue;
      const prefix = `${provider}/`;
      const candidates = live.filter(
        (id) => id.startsWith(prefix) && entry.pattern.test(id.slice(prefix.length)),
      );
      if (candidates.length > 0) return pickHighestVersion(candidates);
    }
  }

  // Step 8: Curated fallback chain.
  for (const provider of preferences) {
    const entry =
      PROVIDER_TABLE_V1_0_0_RC_5[tier][
        provider as keyof (typeof PROVIDER_TABLE_V1_0_0_RC_5)[typeof tier]
      ];
    if (!entry) continue;
    if (live === undefined) {
      env.warnings.push({
        target: "opencode",
        message: `opencode CLI unavailable; using curated fallback ${entry.curated} for tier '${tier}'.`,
      });
      return entry.curated;
    }
    if (live.includes(entry.curated)) {
      env.warnings.push({
        target: "opencode",
        message: `tier '${tier}' had no version match in live list; using curated literal ${entry.curated}.`,
      });
      return entry.curated;
    }
  }

  // Step 9: Resolution failed. Before fail-loud, distinguish "user
  // doesn't have OpenCode" from "user has OpenCode but no providers
  // authenticated". The existing fail-loud message tells the user to
  // "run opencode auth login" — wrong advice if they don't have
  // OpenCode at all. Mirrors the contract Kiro/Claude/Codex resolvers
  // already implement, but the auth check is lazy: only consulted in
  // the failure path so happy-path tests don't need to stub it.
  //
  // Note this is the only path that exercises detectOpenCodeAuth; tests
  // that drive the live-list / env-override / curated-fallback paths
  // never reach here, so they don't need the seam either.
  const detect = env.detectOpenCodeAuth ?? (() => defaultDetectOpenCodeAuth());
  const auth = await detect();
  if (auth.status === "cli-not-installed") {
    if (env.allowMissingCli) {
      env.warnings.push({
        target: "opencode",
        message:
          "opencode CLI not installed; rendering tier '" + tier + "' as '" +
          TIER_TO_OPENCODE[tier] + "' (install the CLI or set SMITH_TIER_" +
          tier.toUpperCase() + " to override).",
      });
      return TIER_TO_OPENCODE[tier];
    }
    throw new PlatformUnavailableError("opencode", "opencode CLI is not installed");
  }

  // CLI is installed; the existing fail-loud message ("run opencode
  // auth login") is accurate.
  const authenticated = env.detectAuthenticatedProviders
    ? await env.detectAuthenticatedProviders()
    : [];

  const hint = formatModelResolutionHint(tier, preferences, authenticated);
  throw new SmithError({
    code: "model-resolution-failed",
    agent: canonical.name,
    tier,
    preferences,
    authenticated,
    hint,
  });
}

async function resolveProviderPreferences(env: ModelResolutionEnv): Promise<string[]> {
  const processEnv = env.env ?? process.env;
  const envProviders = processEnv.SMITH_MODEL_PROVIDERS;
  if (envProviders) {
    return envProviders
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const detected = env.detectAuthenticatedProviders ? await env.detectAuthenticatedProviders() : [];
  return sortByOpenCodePrecedence(detected);
}

function formatModelResolutionHint(
  tier: Exclude<CanonicalModelTier, "inherit">,
  preferences: string[],
  authenticated: string[],
): string {
  const lines = [
    `No model resolvable for tier '${tier}'.`,
    "To fix, do one of:",
    `  • Set SMITH_TIER_${tier.toUpperCase()}=<provider>/<model-id> in your environment`,
    `  • Set "model": "<provider>/<model-id>" in agent.config.json`,
    `  • Authenticate a provider that offers this tier: opencode auth login <provider>`,
  ];
  if (preferences.length > 0) {
    lines.push(`Checked providers: ${preferences.join(", ")}`);
  }
  if (authenticated.length > 0) {
    lines.push(`Authenticated: ${authenticated.join(", ")}`);
  }
  return lines.join("\n");
}
