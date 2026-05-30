import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// Mirror of the smith CLI's `src/io/atomic-write.ts` (atomicWriteJson) for
// arbitrary text. The GUI server is its own workspace and cannot import from
// the CLI source tree (same precedent as `services/installed-status.ts` /
// `services/refresh-manifest.ts`).
//
// rename(2) is atomic on POSIX when both paths sit on the same filesystem,
// so the destination flips from previous to new content in one inode op.
// This does NOT serialize concurrent writers: last-writer-wins. A full file
// lock can be added if multi-process contention becomes a concern.

let staging = 0;

/**
 * Write `content` to a per-call temp file in the destination's parent dir,
 * then `rename` over the destination. The parent directory is `mkdir -p`'d.
 *
 * On rename failure the staged temp file is removed best-effort and the
 * original error is re-thrown.
 */
export async function atomicWriteText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${++staging}`;
  await Bun.write(tmp, content);
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
