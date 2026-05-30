import { z } from "zod";

const Platform = z.enum(["opencode", "claude-code", "codex", "kiro"]);

const PlatformAuthSummary = z.object({
  cliInstalled: z.boolean(),
  status: z.enum(["authenticated", "unauthenticated", "cli-not-installed", "unknown"]),
  detail: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
});

const TierKey = z.enum(["high", "balanced", "fast"]);

export const ModelConfigSchema = z.object({
  /**
   * Legacy: list of OpenCode providers detected (auth.json keys, or
   * inferred from `opencode models` prefixes). Retained for back-compat
   * with the original ModelConfigPage; new UI prefers the `platforms`
   * matrix below for parity with `smith doctor`.
   */
  detectedProviders: z.array(z.string()),
  preferenceOrder: z.array(
    z.object({
      provider: z.string(),
      source: z.enum(["env", "file", "default"]),
    }),
  ),
  /**
   * Legacy OpenCode-specific tier preview. Retained for back-compat.
   * New consumers should use `tierMatrix` which spans all platforms.
   */
  tierPreview: z.array(
    z.object({
      tier: TierKey,
      resolved: z.string().nullable(),
      source: z.enum(["override", "live", "curated", "failed"]),
      message: z.string().optional(),
    }),
  ),
  tierOverrides: z.object({
    high: z.string().nullable(),
    balanced: z.string().nullable(),
    fast: z.string().nullable(),
  }),
  /**
   * Per-platform auth readiness — same data as the doctor's "Platform
   * readiness" section. Lets the model-config page show OpenCode +
   * Claude Code + Codex + Kiro independently rather than only OpenCode.
   */
  platforms: z.record(Platform, PlatformAuthSummary),
  /**
   * Per-platform tier resolution preview. For each tier (high/balanced/
   * fast), what model literal would each platform's resolver emit?
   * `null` means the platform can't resolve this tier (CLI absent, or
   * unauthenticated). Mirrors the doctor's per-platform tier preview.
   */
  tierMatrix: z.array(
    z.object({
      tier: TierKey,
      perPlatform: z.record(Platform, z.string().nullable()),
    }),
  ),
  /**
   * Per-platform tier overrides read from .env. Null means no override
   * is configured for that platform/tier. The OpenCode-specific
   * `tierOverrides` field above is the legacy view; this one
   * generalizes it.
   */
  perPlatformTierOverrides: z.record(
    Platform,
    z.object({
      high: z.string().nullable(),
      balanced: z.string().nullable(),
      fast: z.string().nullable(),
    }),
  ),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const PutModelConfigBodySchema = z.object({
  preferenceOrder: z.array(z.string()).optional(),
  /**
   * Legacy OpenCode-specific tier override write. Sets SMITH_TIER_<TIER>
   * env vars in the shared .env file. Equivalent to
   * `perPlatformTierOverrides.opencode` in the new payload shape.
   */
  tierOverrides: z
    .object({
      high: z.string().nullable().optional(),
      balanced: z.string().nullable().optional(),
      fast: z.string().nullable().optional(),
    })
    .optional(),
  /**
   * Per-platform tier overrides. Writes
   * SMITH_<PLATFORM>_TIER_<TIER> env vars. The opencode entry is
   * equivalent to the legacy SMITH_TIER_<TIER>.
   */
  perPlatformTierOverrides: z
    .record(
      Platform,
      z.object({
        high: z.string().nullable().optional(),
        balanced: z.string().nullable().optional(),
        fast: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
export type PutModelConfigBody = z.infer<typeof PutModelConfigBodySchema>;
