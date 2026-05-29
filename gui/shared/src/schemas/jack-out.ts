import { z } from "zod";

/**
 * Parsed output of `smith jack-out --dry-run`. The CLI emits plain text
 * (no `--json` flag — see plan Amendment N), so the server endpoint
 * captures `stdout` as `rawOutput` and surfaces the indented-path lines
 * separately for terse rendering. The GUI panel prefers the `rawOutput`
 * for the authoritative view.
 */
export const JackOutDryRun = z.object({
  rawOutput: z.string(),
  lines: z.array(z.string()),
});
export type JackOutDryRun = z.infer<typeof JackOutDryRun>;
