import { z } from "zod";
import { Platform } from "./agents";

/** OpenCode per-platform freshness states. */
const DriftSummary = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
  headline: z.string(),
});

const OpencodePlatform = z
  .object({
    platform: z.literal("opencode"),
    vendoredDate: z.string(),
    sourceUrl: z.string(),
    liveSchemaId: z.string().nullable(),
    liveVersion: z.string().nullable(),
  })
  .and(
    z.discriminatedUnion("status", [
      z.object({ status: z.literal("fresh") }),
      z.object({ status: z.literal("drift"), drift: DriftSummary }),
      z.object({ status: z.literal("network-error"), networkError: z.string() }),
      z.object({ status: z.literal("offline-skipped") }),
    ]),
  );

/** Manual platforms (claude-code, codex, kiro) carry a single 'manual' status. */
const ManualPlatform = z.object({
  platform: z.enum(["claude-code", "codex", "kiro"]),
  lastVerifiedDate: z.string(),
  verifiedAgainstVersion: z.string(),
  sourceUrl: z.string(),
  notes: z.string(),
  status: z.literal("manual"),
});

export const DoctorPlatformReport = z.union([OpencodePlatform, ManualPlatform]);
export type DoctorPlatformReport = z.infer<typeof DoctorPlatformReport>;

/** Atlassian skills runtime status (when atlassian-skills is installed). */
const AtlassianSkillsRuntimeStatus = z.object({
  installed: z.literal(true),
  bridgeStatus: z.enum(["in-sync", "not-bridged", "drift"]),
  bridgeReasons: z.array(z.string()).optional(),
  python: z.object({
    binary: z.enum(["python3", "python"]).nullable(),
    version: z.string().nullable(),
    versionOk: z.boolean(),
    packagesAvailable: z.object({
      requests: z.boolean(),
      dotenv: z.boolean(),
    }),
  }),
});

/** Atlassian auth section. */
const AtlassianAuth = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("configured"),
    source: z.enum(["env-smith", "file-smith"]),
    baseUrl: z.string(),
    atlassianSkills: AtlassianSkillsRuntimeStatus.optional(),
  }),
  z.object({
    status: z.literal("incomplete"),
    source: z.enum(["env-smith", "file-smith"]),
    reason: z.literal("missing-base-url"),
    atlassianSkills: AtlassianSkillsRuntimeStatus.optional(),
  }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("not-applicable") }),
]);

/**
 * Top-level real-shape report. Optional sections are kept as `z.unknown()`
 * where the GUI doesn't yet render them — this preserves forward compatibility
 * with new section types added by the CLI without forcing a GUI schema update.
 */
export const DoctorReport = z.object({
  generatedAt: z.string(),
  platforms: z.array(DoctorPlatformReport),
  skippedPlatforms: z.array(Platform),
  modelResolution: z
    .object({
      opencodeCliPath: z.string().nullable().optional(),
      liveModelCount: z.number().nullable().optional(),
      curatedFallbacks: z
        .array(z.object({ tier: z.string(), value: z.string(), inLiveList: z.boolean() }))
        .optional(),
      installedAgents: z.array(z.unknown()).optional(),
      hasStale: z.boolean().optional(),
      detectedProviders: z.array(z.string()).optional(),
      preferenceOrder: z
        .array(z.object({ provider: z.string(), source: z.enum(["env", "file", "default"]) }))
        .optional(),
      tierPreview: z
        .array(
          z.object({
            tier: z.enum(["high", "balanced", "fast"]),
            resolved: z.string().nullable(),
            source: z.enum(["override", "live", "curated", "failed"]),
            message: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  workspace: z.unknown().optional(),
  atlassianAuth: AtlassianAuth,
  skillDrift: z.unknown().optional(),
  agentDrift: z.unknown().optional(),
  agentRequiredSkills: z.unknown().optional(),
  registryHygiene: z.unknown().optional(),
  remoteCatalogs: z.unknown().optional(),
  duplicateCatalogs: z.unknown().optional(),
  knowledgeRefresh: z.unknown().optional(),
  knowledgeConsistency: z.unknown().optional(),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});
export type DoctorReport = z.infer<typeof DoctorReport>;

/** No-platform-detected short-circuit refusal shape. */
export const DoctorRefusal = z.object({
  error: z.literal("no-platform-detected"),
  message: z.string(),
  exitCode: z.literal(2),
});
export type DoctorRefusal = z.infer<typeof DoctorRefusal>;

/**
 * Plain union (NOT discriminated): `DoctorReport` has no shared key with
 * `DoctorRefusal`, so zod tries each branch in order. Do NOT change to
 * `z.discriminatedUnion` — there is no shared discriminator field.
 */
export const DoctorResponse = z.union([DoctorReport, DoctorRefusal]);
export type DoctorResponse = z.infer<typeof DoctorResponse>;
