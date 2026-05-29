import pc from "picocolors";
import type { KnowledgeSummary } from "../io/knowledge-summary";

/**
 * Format a byte count for CLI output.
 * - <1KB: `<n>B` (integer)
 * - <1MB: `<n>.<d>KB` (one decimal)
 * - else: `<n>.<d>MB` (one decimal)
 *
 * Used by the install command's knowledge-summary tally line. Pure function.
 */
export function prettyBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Render a KnowledgeSummary into CLI display lines (one per source + one tally).
 * Empty sources → empty array, signalling the caller to suppress the block entirely.
 *
 * Format per source:
 *   → knowledge <id> (<n> file[s], <bytes>, <delivery>)              (changed)
 *   · knowledge <id> (<n> file[s], <bytes>, <delivery>) (unchanged)  (unchanged)
 *
 * Format tally:
 *   <c> changed, <u> unchanged · <files>, <bytes>[· inline tokens <used>/<budget>]
 *
 * The inline-tokens clause is suppressed when no source has delivery=inline,
 * to avoid showing a confusing "0/4000" on agents that only ship file-delivery.
 */
export function formatKnowledgeLines(summary: KnowledgeSummary): string[] {
  if (summary.sources.length === 0) return [];

  const lines: string[] = [];
  let changedCount = 0;
  let unchangedCount = 0;

  for (const s of summary.sources) {
    const fileWord = s.files === 1 ? "file" : "files";
    const body = `knowledge ${s.id} (${s.files} ${fileWord}, ${prettyBytes(s.bytes)}, ${s.delivery})`;
    if (s.changed) {
      changedCount += 1;
      lines.push(`${pc.green("→")} ${body}`);
    } else {
      unchangedCount += 1;
      lines.push(`${pc.dim(`· ${body} (unchanged)`)}`);
    }
  }

  const totalsFileWord = summary.totals.files === 1 ? "file" : "files";
  const tallyParts = [
    `${changedCount} changed, ${unchangedCount} unchanged`,
    `${summary.totals.files} ${totalsFileWord}, ${prettyBytes(summary.totals.bytes)}`,
  ];
  if (summary.totals.hasInline) {
    tallyParts.push(
      `inline tokens ${summary.totals.tokensInline}/${summary.totals.tokensInlineBudget}`,
    );
  }
  lines.push(pc.dim(tallyParts.join(" · ")));

  return lines;
}
