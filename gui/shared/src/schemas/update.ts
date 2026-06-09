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
  /** "source" (git clone) or "packaged" (npm/bun/pnpm). Optional for back-compat. */
  installKind: z.enum(["source", "packaged", "unknown"]).optional(),
  /** Manager-agnostic "is an upgrade available" signal. For source installs this
   *  mirrors `!alreadyUpToDate`; for packaged it's derived from the dry-run query. */
  updateAvailable: z.boolean().optional(),
});
export type UpdatePreview = z.infer<typeof UpdatePreview>;
