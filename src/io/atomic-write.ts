// Atomic JSON file writes via temp+rename. Used by both the agent
// registry and the skill catalog registry to guarantee that a crash
// mid-write can never leave a half-written file on disk.
//
// rename(2) is atomic on POSIX when both paths sit on the same
// filesystem, so the destination flips from the previous content to the
// new content in one inode operation. This does NOT serialize concurrent
// writers: last writer wins. A full file lock can come later if
// multi-process contention becomes a concern.

import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// Module-local sequence to disambiguate concurrent in-process writers
// to the same destination. Combined with the pid this gives a temp name
// that's unique per call without needing a syscall (mktemp/unique-id).
let staging = 0;

/**
 * Serialize `data` to JSON, write it to a per-call temp file in the same
 * directory, then `rename` over the destination. The parent directory is
 * `mkdir -p`'d.
 *
 * If the rename fails (cross-device, permission, missing parent that
 * mkdir somehow couldn't create, etc.) the staged temp file is removed
 * on a best-effort basis and the original error is re-thrown.
 *
 * Concurrent in-process writers each stage to a distinct temp file, so
 * no two `rename`s ever target the same source path. The destination
 * still exhibits last-writer-wins semantics, which is the intended
 * contract — atomicity guarantees no half-written file, not exclusivity.
 */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${++staging}`;
  await Bun.write(tmp, `${JSON.stringify(data, null, 2)}\n`);
  try {
    await rename(tmp, path);
  } catch (err) {
    // Swallow unlink errors: the rename failure is what the caller cares
    // about, and litter cleanup is a best-effort courtesy.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
