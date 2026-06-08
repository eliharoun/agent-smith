import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JobHistoryEntry } from "../../../shared/src/index";

/** Max per-job `.log` files retained on disk. Older logs are pruned by mtime. */
export const OUTPUT_FILES_KEEP = 50;
/** Max age of entries in the JSONL file. Older entries are pruned on startup. */
export const ENTRIES_KEEP_DAYS = 30;

export interface JobHistoryPaths {
  jsonlPath: string;
  outputDir: string;
}

export interface JobOutputSink {
  writeChunk(chunk: string): void;
  /** Resolves when the underlying file has flushed. */
  close(): Promise<void>;
}

export interface JobHistoryWriter {
  beginJob(id: string): Promise<JobOutputSink>;
  finalize(summary: {
    id: string;
    command: string;
    argvPreview: string;
    startedAt: number;
    endedAt: number;
    exitCode: number;
    degraded?: boolean;
    warnings?: string[];
  }): Promise<void>;
}

/**
 * Create a writer that owns the JSONL file lock + output directory rotation.
 *
 * The writer is best-effort: errors during finalize are routed through
 * `onError` (default: console.warn) and never propagated, so JobManager's
 * exit path can never throw because of disk issues.
 *
 * JSONL appends are serialized through a single-slot promise chain so
 * concurrent `finalize` calls produce well-formed records (no interleaved
 * partial writes).
 */
export function createJobHistoryWriter(
  opts: JobHistoryPaths & {
    keepOutputs?: number;
    onError?: (err: unknown) => void;
  },
): JobHistoryWriter {
  const keep = opts.keepOutputs ?? OUTPUT_FILES_KEEP;
  const onError = opts.onError ?? ((err) => console.warn("[job-history]", err));
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    // Keep the chain alive even if fn throws; swallow for continuity.
    queue = next.catch(() => {});
    return next;
  };

  const sinks = new Map<
    string,
    { stream: ReturnType<typeof createWriteStream>; closed: Promise<void> }
  >();

  return {
    async beginJob(id) {
      await mkdir(opts.outputDir, { recursive: true });
      const path = join(opts.outputDir, `${id}.log`);
      const stream = createWriteStream(path, { flags: "w" });
      const closed = new Promise<void>((res, rej) => {
        stream.on("finish", () => res());
        stream.on("error", (err) => rej(err));
      });
      sinks.set(id, { stream, closed });
      return {
        writeChunk(chunk: string) {
          stream.write(chunk);
        },
        async close() {
          stream.end();
          await closed;
        },
      };
    },

    async finalize(summary) {
      const sink = sinks.get(summary.id);
      if (sink) {
        sink.stream.end();
        try {
          await sink.closed;
        } catch (err) {
          onError(err);
        }
        sinks.delete(summary.id);
      }
      await enqueue(async () => {
        const outputPath = join(opts.outputDir, `${summary.id}.log`);
        let outputAvailable = false;
        try {
          await stat(outputPath);
          outputAvailable = true;
        } catch {
          // file vanished or never written
        }
        const entry = {
          id: summary.id,
          command: summary.command,
          argvPreview: summary.argvPreview,
          startedAt: summary.startedAt,
          endedAt: summary.endedAt,
          exitCode: summary.exitCode,
          durationMs: Math.max(0, summary.endedAt - summary.startedAt),
          outputAvailable,
          ...(summary.degraded ? { degraded: true } : {}),
          ...(summary.warnings?.length ? { warnings: summary.warnings } : {}),
        };
        try {
          // Use writeFile with flag 'a' to avoid managing a long-lived fd
          // that could leak across hot reloads.
          await writeFile(opts.jsonlPath, JSON.stringify(entry) + "\n", { flag: "a" });
        } catch (err) {
          onError(err);
          return;
        }
        try {
          await rotateOutputs(opts.outputDir, keep);
        } catch (err) {
          onError(err);
        }
      });
    },
  };
}

async function rotateOutputs(outputDir: string, keep: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const logs = entries.filter((e) => e.endsWith(".log"));
  if (logs.length <= keep) return;
  const withStats = await Promise.all(
    logs.map(async (name) => {
      const p = join(outputDir, name);
      const s = await stat(p);
      return { name, p, mtime: s.mtimeMs };
    }),
  );
  withStats.sort((a, b) => a.mtime - b.mtime);
  const drop = withStats.slice(0, withStats.length - keep);
  for (const d of drop) {
    try {
      await unlink(d.p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export async function readJobHistory(opts: {
  jsonlPath: string;
  limit?: number;
  offset?: number;
}): Promise<JobHistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(opts.jsonlPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const out: JobHistoryEntry[] = [];
  for (const ln of lines) {
    try {
      const parsed = JobHistoryEntry.parse(JSON.parse(ln));
      out.push(parsed);
    } catch {}
  }
  out.reverse(); // most-recent first
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? out.length;
  return out.slice(offset, offset + limit);
}

export async function readJobOutput(
  id: string,
  opts: { outputDir: string },
): Promise<string | null> {
  try {
    return await readFile(join(opts.outputDir, `${id}.log`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Drop entries older than ENTRIES_KEEP_DAYS. Rewrites the file atomically
 * via a sibling .tmp + rename. Called on server start by app.ts.
 */
export async function sweepOldEntries(opts: { jsonlPath: string; now?: number }): Promise<void> {
  const cutoff = (opts.now ?? Date.now()) - ENTRIES_KEEP_DAYS * 86_400_000;
  let raw: string;
  try {
    raw = await readFile(opts.jsonlPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const kept: string[] = [];
  for (const ln of lines) {
    try {
      const obj = JSON.parse(ln) as { startedAt?: number };
      if (typeof obj.startedAt === "number" && obj.startedAt >= cutoff) {
        kept.push(ln);
      }
    } catch {
      // drop unparseable
    }
  }
  const next = kept.length === 0 ? "" : kept.join("\n") + "\n";
  const tmp = `${opts.jsonlPath}.tmp`;
  await writeFile(tmp, next);
  await rename(tmp, opts.jsonlPath);
}
