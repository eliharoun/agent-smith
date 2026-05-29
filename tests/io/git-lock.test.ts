// tests/io/git-lock.test.ts
//
// C4.0.3 (v1-task): cooperative file lock that serializes git clone/fetch
// against the same target directory. Used by cloneOrFetch to prevent
// concurrent GUI + CLI installs from racing on the same clone path.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../../src/io/git-lock";

describe("withFileLock (C4.0.3)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "git-lock-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("runs fn while holding the lock and returns its result", async () => {
    const lockPath = join(dir, "test.lock");
    const result = await withFileLock(lockPath, async () => "ok");
    expect(result).toBe("ok");
  });

  test("releases lock even when fn throws", async () => {
    const lockPath = join(dir, "test.lock");
    await expect(
      withFileLock(lockPath, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Second acquire should succeed if release ran.
    await expect(withFileLock(lockPath, async () => "ok")).resolves.toBe("ok");
  });

  test("serializes concurrent acquisitions against the same lock path", async () => {
    const lockPath = join(dir, "test.lock");
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
    };
    await Promise.all([
      withFileLock(lockPath, slow),
      withFileLock(lockPath, slow),
      withFileLock(lockPath, slow),
    ]);
    expect(maxInFlight).toBe(1);
  });

  test("creates parent directory if missing", async () => {
    const lockPath = join(dir, "nested", "deep", "test.lock");
    const result = await withFileLock(lockPath, async () => 42);
    expect(result).toBe(42);
  });
});
