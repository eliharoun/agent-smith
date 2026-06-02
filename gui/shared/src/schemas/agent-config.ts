import { z } from "zod";
import { Target } from "./agents";

/**
 * Canonical model tiers offered in the GUI dropdown. The CLI's canonical
 * schema also accepts the aliases opus/sonnet/haiku (→ high/balanced/fast);
 * the GUI normalizes those to canonical before saving, so this patch schema
 * accepts only the canonical four.
 */
export const ModelTier = z.enum(["high", "balanced", "fast", "inherit"]);
export type ModelTier = z.infer<typeof ModelTier>;

/**
 * Permissive `knowledge` patch. We accept any object here on the GUI-shared
 * side and rely on the server's PUT handler to re-validate against the
 * canonical `KnowledgeBlockSchema` (loaded dynamically from
 * src/core/knowledge/schema.ts) before writing. This mirrors the existing
 * "permissive parity" stance taken by gui/shared/src/schemas/knowledge.ts:
 * the CLI is the source of truth for authoring-time validation; the GUI
 * stays loose so it can round-trip slightly-non-canonical bundles authored
 * in the wild without rejecting them. See agents.ts route for the strict
 * server-side re-validation step (defense in depth).
 */
const KnowledgePatch = z.record(z.string(), z.unknown());

/**
 * `mcpServers` patch (Task v2.1-D, fix). The canonical CLI schema models
 * `mcpServers` as a string array of server *names* (documentation-only; the
 * spawn config — `command`, `args`, etc. — lives in the user's AI-client
 * global MCP config, not in the bundle). The MCP wiring toggle therefore
 * sends the full new array of names; the server replaces verbatim. The
 * earlier permissive object-map shape produced bundles that failed
 * `CanonicalConfigSchema.safeParse()` and broke `smith agent validate` /
 * `smith agent install`.
 */
const McpServersPatch = z.array(z.string().min(1));

/**
 * Body for `PUT /api/agents/:name/config`. At least one field must be present.
 * `targets`, when present, must be non-empty (the canonical config requires
 * at least one target). `knowledge`, when present, REPLACES the entire
 * knowledge block (the GUI round-trips the full block when editing a single
 * source). `mcpServers`, when present, REPLACES the entire array (the GUI
 * sends the full deduplicated array of server names computed client-side
 * from the toggle outcome).
 */
export const AgentConfigPatch = z
  .object({
    targets: z.array(Target).min(1, "at least one target required").optional(),
    modelTier: ModelTier.optional(),
    knowledge: KnowledgePatch.optional(),
    mcpServers: McpServersPatch.optional(),
  })
  .refine(
    (v) =>
      v.targets !== undefined ||
      v.modelTier !== undefined ||
      v.knowledge !== undefined ||
      v.mcpServers !== undefined,
    {
      message:
        "at least one of `targets`, `modelTier`, `knowledge`, or `mcpServers` must be provided",
    },
  );
export type AgentConfigPatch = z.infer<typeof AgentConfigPatch>;
