import { z } from "zod";
import { Platform } from "./agents";

/**
 * Canonical model tiers offered in the GUI dropdown. The CLI's canonical
 * schema also accepts the aliases opus/sonnet/haiku (→ high/balanced/fast);
 * the GUI normalizes those to canonical before saving, so this patch schema
 * accepts only the canonical four.
 */
export const ModelTier = z.enum(["high", "balanced", "fast", "inherit"]);
export type ModelTier = z.infer<typeof ModelTier>;

/**
 * Body for `PUT /api/agents/:name/config`. At least one field must be present.
 * `targets`, when present, must be non-empty (the canonical config requires
 * at least one target).
 */
export const AgentConfigPatch = z
  .object({
    targets: z.array(Platform).min(1, "at least one target required").optional(),
    modelTier: ModelTier.optional(),
  })
  .refine((v) => v.targets !== undefined || v.modelTier !== undefined, {
    message: "at least one of `targets` or `modelTier` must be provided",
  });
export type AgentConfigPatch = z.infer<typeof AgentConfigPatch>;
