// tests/io/clone-purge-guard.test.ts
//
// [v1-task RC2-9] Unit coverage for assertSafeToPurgeClone. Exercises
// every refusal branch (mode, containment, .git, origin-mismatch,
// origin-unreadable) using stubbed `readOrigin` so we don't have to
// spawn git from the test runner.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeToPurgeClone } from "../../src/io/clone-purge-guard";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clone-purge-guard-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeRepo(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

const ok = (url: string) => async () => url;

describe("assertSafeToPurgeClone [v1-task RC2-9]", () => {
  test("refuses linked catalog (no remote{})", async () => {
    const dir = await makeRepo("linked");
    await expect(
      assertSafeToPurgeClone(
        { rootPath: dir },
        { remoteRoot: root, readOrigin: ok("https://github.com/a/b.git") },
      ),
    ).rejects.toThrow(/linked.*no remote/i);
  });

  test("refuses path outside remote root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      await expect(
        assertSafeToPurgeClone(
          { rootPath: outside, remote: { url: "https://github.com/a/b.git" } },
          { remoteRoot: root, readOrigin: ok("https://github.com/a/b.git") },
        ),
      ).rejects.toThrow(/outside.*remote.*root/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("refuses managed catalog whose .git is missing", async () => {
    const dir = join(root, "no-git");
    await mkdir(dir, { recursive: true });
    await expect(
      assertSafeToPurgeClone(
        { rootPath: dir, remote: { url: "https://github.com/a/b.git" } },
        { remoteRoot: root, readOrigin: ok("https://github.com/a/b.git") },
      ),
    ).rejects.toThrow(/no \.git directory/i);
  });

  test("refuses when readOrigin returns undefined (unreadable origin)", async () => {
    const dir = await makeRepo("broken");
    await expect(
      assertSafeToPurgeClone(
        { rootPath: dir, remote: { url: "https://github.com/a/b.git" } },
        { remoteRoot: root, readOrigin: async () => undefined },
      ),
    ).rejects.toThrow(/could not read 'origin'/i);
  });

  test("refuses when origin URL diverges from recorded remote.url", async () => {
    const dir = await makeRepo("repointed");
    await expect(
      assertSafeToPurgeClone(
        { rootPath: dir, remote: { url: "https://github.com/a/b.git" } },
        { remoteRoot: root, readOrigin: ok("https://github.com/x/y.git") },
      ),
    ).rejects.toThrow(/origin.*does not match/i);
  });

  test("accepts when mode=managed + inside root + .git present + origin matches", async () => {
    const dir = await makeRepo("happy");
    // sameGitRemote normalizes case/trailing-.git/protocol, so this
    // intentionally varies the scheme to prove normalization runs.
    await expect(
      assertSafeToPurgeClone(
        { rootPath: dir, remote: { url: "https://github.com/Owner/Repo.git" } },
        { remoteRoot: root, readOrigin: ok("git@github.com:owner/repo") },
      ),
    ).resolves.toBeUndefined();
  });
});
