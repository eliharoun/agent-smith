import { z } from "zod";

/**
 * Result of `smith update --dry-run`, parsed from the CLI's plain-text
 * output (see `src/cli/commands/update.ts`). Two terminal shapes:
 *
 *   - `alreadyUpToDate: true, commitsBehind: 0` — local tracks origin/main.
 *   - `alreadyUpToDate: false, commitsBehind: N` — N commits ready to pull.
 *
 * `rawOutput` preserves the full CLI output so the GUI can render the
 * authoritative text alongside the parsed summary.
 */
export const UpdatePreview = z.object({
  commitsBehind: z.number().int().nonnegative(),
  alreadyUpToDate: z.boolean(),
  rawOutput: z.string(),
});
export type UpdatePreview = z.infer<typeof UpdatePreview>;
