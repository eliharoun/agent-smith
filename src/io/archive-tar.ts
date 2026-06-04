import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { create as tarCreate, list as tarList, type ReadEntry } from "tar";

export interface ArchiveEntry {
  /** POSIX path inside the archive (forward slashes). */
  path: string;
  bytes: Buffer;
  /** Optional file mode. Default 0o644; directories handled implicitly. */
  mode?: number;
}

export interface WriteArchiveOptions {
  gzip: boolean;
}

export interface ReadArchiveEntry {
  path: string;
  bytes: Buffer;
  mtime: Date | null;
  mode: number;
}

const PINNED_MTIME = new Date(0);

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export async function writeArchive(
  entries: ArchiveEntry[],
  opts: WriteArchiveOptions,
): Promise<Buffer> {
  const sorted = [...entries].sort(byPath);
  const stage = await mkdtemp(join(tmpdir(), "smith-archive-"));
  const outName = `smith-archive-out-${process.pid}-${randomBytes(6).toString("hex")}.tar${opts.gzip ? ".gz" : ""}`;
  const out = join(tmpdir(), outName);
  try {
    const written: string[] = [];
    for (const e of sorted) {
      const fsPath = e.path.split("/").join(sep);
      const abs = join(stage, fsPath);
      if (!abs.startsWith(stage + sep)) {
        throw new Error(`entry path escapes stage directory: ${e.path}`);
      }
      await mkdirp(dirnameSep(abs));
      await writeFile(abs, e.bytes, { mode: e.mode ?? 0o644 });
      await utimes(abs, PINNED_MTIME, PINNED_MTIME);
      written.push(e.path);
    }
    await tarCreate(
      {
        gzip: opts.gzip,
        file: out,
        cwd: stage,
        portable: true,
        prefix: "",
      },
      written,
    );
    return await readFile(out);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(out, { force: true });
  }
}

// Hard caps to prevent a small compressed archive from expanding to an
// unbounded amount of memory.
const MAX_ENTRIES = 10_000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB decompressed

export async function readArchive(buffer: Buffer): Promise<ReadArchiveEntry[]> {
  const out: ReadArchiveEntry[] = [];
  let totalBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from(buffer);
    stream
      .pipe(
        tarList({
          onentry: (entry: ReadEntry) => {
            if (out.length >= MAX_ENTRIES) {
              reject(new Error(`archive has too many entries (>${MAX_ENTRIES})`));
              entry.resume();
              return;
            }
            if (entry.type !== "File") {
              entry.resume();
              return;
            }
            const chunks: Buffer[] = [];
            entry.on("data", (c: Buffer) => {
              totalBytes += c.length;
              if (totalBytes > MAX_TOTAL_BYTES) {
                reject(new Error(`archive decompressed size exceeds ${MAX_TOTAL_BYTES} bytes`));
                return;
              }
              chunks.push(c);
            });
            entry.on("end", () => {
              out.push({
                path: entry.path,
                bytes: Buffer.concat(chunks),
                mtime: entry.mtime ?? null,
                mode: entry.mode ?? 0o644,
              });
            });
          },
        }),
      )
      .on("end", () => resolve())
      .on("error", reject);
  });
  return out.sort(byPath);
}

async function mkdirp(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

function dirnameSep(p: string): string {
  const idx = p.lastIndexOf(sep);
  return idx === -1 ? "." : p.slice(0, idx);
}
