import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { JobHistorySearchHit } from "../../../shared/src/index";

export interface LogSearchDeps {
  outputDir: string;
  limit?: number;
  /** Defaults to true; tests pass false to force JS fallback. */
  useRipgrep?: boolean;
}

/**
 * Substring search across the retained per-job `.log` files under
 * `outputDir`. Prefers `rg` for speed and context handling; falls back
 * to a streaming JS scan if `rg` is missing or fails.
 *
 * Returns at most `limit` hits (default 20). Empty queries short-circuit
 * to `[]`. Missing `outputDir` is treated as "no hits" (not an error).
 */
export async function searchLogs(
  query: string,
  deps: LogSearchDeps,
): Promise<JobHistorySearchHit[]> {
  if (query.length === 0) return [];
  const limit = deps.limit ?? 20;
  const useRg = deps.useRipgrep ?? true;
  if (useRg && (await rgAvailable())) {
    try {
      return await searchWithRipgrep(query, deps.outputDir, limit);
    } catch {
      // Fall through to JS fallback on any rg failure.
    }
  }
  return searchWithJs(query, deps.outputDir, limit);
}

async function rgAvailable(): Promise<boolean> {
  return Boolean(Bun.which("rg"));
}

async function searchWithRipgrep(
  query: string,
  dir: string,
  limit: number,
): Promise<JobHistorySearchHit[]> {
  const proc = Bun.spawn(["rg", "-n", "-C", "1", "--no-heading", "--", query, dir], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 3000,
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return parseRipgrepOutput(out).slice(0, limit);
}

/**
 * rg with `-n -C 1 --no-heading` emits records like:
 *   /path/to/j1.log-1-alpha
 *   /path/to/j1.log:2:ERROR: bad
 *   /path/to/j1.log-3-gamma
 *   --
 *   /path/to/j2.log:5:matched line
 *
 * `:LINE:` = match, `-LINE-` = context. Records are separated by `--`.
 */
function parseRipgrepOutput(out: string): JobHistorySearchHit[] {
  const hits: JobHistorySearchHit[] = [];
  const blocks = out.split("\n--\n");
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    let match: { jobId: string; lineNumber: number; matchedLine: string } | null = null;
    const before: string[] = [];
    const after: string[] = [];
    for (const ln of lines) {
      const matched = ln.match(/^(.+?)([:-])(\d+)\2(.*)$/);
      if (!matched) continue;
      const [, filePath, sep, n, text] = matched as unknown as [
        string,
        string,
        ":" | "-",
        string,
        string,
      ];
      const jobId = basename(filePath, ".log");
      const lineNumber = Number.parseInt(n, 10);
      if (sep === ":") {
        match = { jobId, lineNumber, matchedLine: text };
      } else if (match === null) {
        before.push(text);
      } else {
        after.push(text);
      }
    }
    if (match) {
      hits.push({
        jobId: match.jobId,
        lineNumber: match.lineNumber,
        matchedLine: match.matchedLine,
        ...(before.length > 0 ? { contextBefore: before } : {}),
        ...(after.length > 0 ? { contextAfter: after } : {}),
      });
    }
  }
  return hits;
}

async function searchWithJs(
  query: string,
  dir: string,
  limit: number,
): Promise<JobHistorySearchHit[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".log"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const hits: JobHistorySearchHit[] = [];
  for (const file of files) {
    if (hits.length >= limit) break;
    const raw = await readFile(join(dir, file), "utf8");
    const lines = raw.split("\n");
    const jobId = basename(file, ".log");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes(query)) continue;
      const hit: JobHistorySearchHit = {
        jobId,
        lineNumber: i + 1,
        matchedLine: lines[i]!,
      };
      if (i > 0) hit.contextBefore = [lines[i - 1]!];
      if (i < lines.length - 1 && lines[i + 1]!.length > 0) {
        hit.contextAfter = [lines[i + 1]!];
      }
      hits.push(hit);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
