// src/io/git-lock.ts
//
// C4.0.3 (v1-task): cooperative file lock for serializing concurrent git
// clone/fetch operations against the same target directory. Backed by
// O_EXCL file creation — portable across macOS and Linux, no dependencies.
//
// This is a *cooperative* lock: only code paths that go through
// withFileLock() participate. That's fine here because every clone+fetch
// against an external repo goes through cloneOrFetch(), which holds
// the lock for the duration of the git invocation. The lock prevents
// two concurrent install-from-url or sync runs (GUI + CLI, or two
// browser tabs) from racing on the same clone directory and producing
// a corrupt working tree.
//
// Stale-lock handling: if a lock file is older than STALE_LOCK_AGE_MS,
// we assume the holder crashed and reclaim it. The threshold is much
// larger than the slowest realistic clone so live operations are never
// preempted.

import { mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const POLL_INTERVAL_MS = 50;
const STALE_LOCK_AGE_MS = 5 * 60 * 1000; // 5 minutes; longer than slowest realistic clone

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  await acquire(lockPath);
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {
      /* lock file may have been swept by stale-reclaim; ignore */
    });
  }
}

async function acquire(lockPath: string): Promise<void> {
  for (;;) {
    try {
      const fh = await open(lockPath, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (await isStale(lockPath)) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const st = await stat(lockPath);
    return Date.now() - st.mtimeMs > STALE_LOCK_AGE_MS;
  } catch {
    return true; // gone or unreadable → treat as stale
  }
}
