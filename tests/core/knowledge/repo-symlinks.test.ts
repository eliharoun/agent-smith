import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRelativeSymlink,
  sweepStaleCacheEntries,
  sweepStaleRepoSymlinks,
} from "../../../src/core/knowledge/repo-symlinks";
import { SmithError } from "../../../src/core/smith-error";

let roots: string[] = [];

async function makeTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "repo-symlinks-test-"));
  roots.push(dir);
  return dir;
}

async function expectSmithError(
  fn: () => Promise<unknown>,
  reasonPattern: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(SmithError);
  const payload = (caught as SmithError).payload;
  expect(payload.code).toBe("validation-failed");
  expect(JSON.stringify(payload)).toMatch(reasonPattern);
}

beforeEach(() => {
  roots = [];
});

afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

describe("ensureRelativeSymlink", () => {
  test("creates a relative symlink when the link path does not yet exist", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "abc123");
    await mkdir(targetDir, { recursive: true });
    const linkPath = join(root, "repos", "my-source");

    await ensureRelativeSymlink(linkPath, targetDir);

    const linkValue = await readlink(linkPath);
    expect(linkValue).toBe("../.cache/git/abc123");
    const targetStat = await stat(linkPath); // follows symlink
    expect(targetStat.isDirectory()).toBe(true);
  });

  test("uses a relative target path, not an absolute one", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "deadbeef");
    await mkdir(targetDir, { recursive: true });
    const linkPath = join(root, "repos", "src");

    await ensureRelativeSymlink(linkPath, targetDir);

    const linkValue = await readlink(linkPath);
    expect(linkValue.startsWith("/")).toBe(false);
    expect(linkValue).toContain("../");
  });

  test("is idempotent: calling twice with the same target is a no-op", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "same");
    await mkdir(targetDir, { recursive: true });
    const linkPath = join(root, "repos", "s");

    await ensureRelativeSymlink(linkPath, targetDir);
    const before = await readlink(linkPath);
    await ensureRelativeSymlink(linkPath, targetDir);
    const after = await readlink(linkPath);

    expect(after).toBe(before);
  });

  test("atomically replaces a symlink that points at a different target", async () => {
    const root = await makeTmp();
    const oldTarget = join(root, ".cache", "git", "old");
    const newTarget = join(root, ".cache", "git", "new");
    await mkdir(oldTarget, { recursive: true });
    await mkdir(newTarget, { recursive: true });
    const linkPath = join(root, "repos", "s");

    await ensureRelativeSymlink(linkPath, oldTarget);
    await ensureRelativeSymlink(linkPath, newTarget);

    const linkValue = await readlink(linkPath);
    expect(linkValue).toBe("../.cache/git/new");
  });

  test("throws SmithError when linkPath exists as a regular file", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "x");
    await mkdir(targetDir, { recursive: true });
    const reposDir = join(root, "repos");
    await mkdir(reposDir, { recursive: true });
    const linkPath = join(reposDir, "s");
    await writeFile(linkPath, "i am not a symlink", "utf8");

    await expectSmithError(
      () => ensureRelativeSymlink(linkPath, targetDir),
      /refusing to overwrite non-symlink/,
    );
  });

  test("throws SmithError when linkPath exists as a regular directory", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "x");
    await mkdir(targetDir, { recursive: true });
    const linkPath = join(root, "repos", "s");
    await mkdir(linkPath, { recursive: true });

    await expectSmithError(
      () => ensureRelativeSymlink(linkPath, targetDir),
      /refusing to overwrite non-symlink/,
    );
  });

  test("creates the parent repos/ directory when it does not yet exist", async () => {
    const root = await makeTmp();
    const targetDir = join(root, ".cache", "git", "x");
    await mkdir(targetDir, { recursive: true });
    // Note: NO mkdir of root/repos here.
    const linkPath = join(root, "repos", "deep", "src");

    await ensureRelativeSymlink(linkPath, targetDir);

    const linkValue = await readlink(linkPath);
    expect(linkValue).toBeTruthy();
    const resolved = await stat(linkPath); // follows symlink
    expect(resolved.isDirectory()).toBe(true);
  });
});

describe("sweepStaleRepoSymlinks", () => {
  test("returns empty result when repos/ does not exist (no-op)", async () => {
    const root = await makeTmp();
    const result = await sweepStaleRepoSymlinks(root, new Set(["keep"]));
    expect(result.removed).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("removes symlinks whose id is not in currentIds; keeps those that are", async () => {
    const root = await makeTmp();
    const reposDir = join(root, "repos");
    const targetA = join(root, ".cache", "git", "a");
    const targetB = join(root, ".cache", "git", "b");
    await mkdir(targetA, { recursive: true });
    await mkdir(targetB, { recursive: true });
    await mkdir(reposDir, { recursive: true });
    await symlink("../.cache/git/a", join(reposDir, "keep"));
    await symlink("../.cache/git/b", join(reposDir, "stale"));

    const result = await sweepStaleRepoSymlinks(root, new Set(["keep"]));

    expect(result.removed).toEqual(["stale"]);
    expect(result.warnings).toEqual([]);
    // Verify on disk
    const keepLink = await readlink(join(reposDir, "keep"));
    expect(keepLink).toBe("../.cache/git/a");
    await expect(lstat(join(reposDir, "stale"))).rejects.toThrow();
  });

  test("warns (and does NOT remove) when repos/ contains a non-symlink entry", async () => {
    const root = await makeTmp();
    const reposDir = join(root, "repos");
    await mkdir(reposDir, { recursive: true });
    await writeFile(join(reposDir, "stray-file"), "i should not be here", "utf8");

    const result = await sweepStaleRepoSymlinks(root, new Set());

    expect(result.removed).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("stray-file");
    // File still exists
    const s = await lstat(join(reposDir, "stray-file"));
    expect(s.isFile()).toBe(true);
  });

  test("removes a dangling stale symlink even when its target is gone", async () => {
    const root = await makeTmp();
    const reposDir = join(root, "repos");
    await mkdir(reposDir, { recursive: true });
    // Symlink to a target that never existed
    await symlink("../.cache/git/nonexistent", join(reposDir, "dangling"));

    const result = await sweepStaleRepoSymlinks(root, new Set());

    expect(result.removed).toEqual(["dangling"]);
    await expect(lstat(join(reposDir, "dangling"))).rejects.toThrow();
  });
});

describe("sweepStaleCacheEntries", () => {
  test("returns empty result when cacheDir does not exist (no-op)", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache"); // does not exist

    const result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set());

    expect(result.removedGit).toEqual([]);
    expect(result.removedUrl).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("removes git/<hash>/ dirs whose key is stale; keeps current ones", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    const keep = "a".repeat(64);
    const stale = "b".repeat(64);
    await mkdir(join(cacheDir, "git", keep), { recursive: true });
    await mkdir(join(cacheDir, "git", stale), { recursive: true });
    await writeFile(join(cacheDir, "git", keep, "marker"), "k");
    await writeFile(join(cacheDir, "git", stale, "marker"), "s");

    const result = await sweepStaleCacheEntries(cacheDir, new Set([keep]), new Set());

    expect(result.removedGit).toEqual([stale]);
    expect(result.removedUrl).toEqual([]);
    expect(result.warnings).toEqual([]);
    // Keep dir intact
    const keepStat = await lstat(join(cacheDir, "git", keep));
    expect(keepStat.isDirectory()).toBe(true);
    // Stale dir gone
    await expect(lstat(join(cacheDir, "git", stale))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes <hash>.json and <hash>.bin URL pairs whose key is stale", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    const keep = "c".repeat(64);
    const stale = "d".repeat(64);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${keep}.json`), "{}");
    await writeFile(join(cacheDir, `${keep}.bin`), "k");
    await writeFile(join(cacheDir, `${stale}.json`), "{}");
    await writeFile(join(cacheDir, `${stale}.bin`), "s");

    const result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set([keep]));

    expect(result.removedGit).toEqual([]);
    expect(result.removedUrl.sort()).toEqual([`${stale}.bin`, `${stale}.json`]);
    expect(result.warnings).toEqual([]);
    // Keep pair intact
    await lstat(join(cacheDir, `${keep}.json`));
    await lstat(join(cacheDir, `${keep}.bin`));
    // Stale pair gone
    await expect(lstat(join(cacheDir, `${stale}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(cacheDir, `${stale}.bin`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("ignores non-hash-shaped entries in cache dir (e.g., random files, future formats)", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    await mkdir(cacheDir, { recursive: true });
    // Things that should be left alone:
    await writeFile(join(cacheDir, "README.txt"), "users own this");
    await writeFile(join(cacheDir, "abc.json"), "{}"); // hash too short
    await writeFile(join(cacheDir, `${"e".repeat(64)}.txt`), "wrong ext"); // wrong ext
    await writeFile(join(cacheDir, `${"E".repeat(64)}.json`), "{}"); // uppercase
    await mkdir(join(cacheDir, "tar"), { recursive: true }); // hypothetical future cache type

    const result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set());

    expect(result.removedGit).toEqual([]);
    expect(result.removedUrl).toEqual([]);
    expect(result.warnings).toEqual([]);
    // All entries still present
    await lstat(join(cacheDir, "README.txt"));
    await lstat(join(cacheDir, "abc.json"));
    await lstat(join(cacheDir, `${"e".repeat(64)}.txt`));
    await lstat(join(cacheDir, `${"E".repeat(64)}.json`));
    await lstat(join(cacheDir, "tar"));
  });

  test("ignores lock files inside .cache/git/ (not directories)", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    const stale = "f".repeat(64);
    await mkdir(join(cacheDir, "git", stale), { recursive: true });
    await writeFile(join(cacheDir, "git", `${stale}.lock`), "");

    const result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set());

    // Stale dir is removed
    expect(result.removedGit).toEqual([stale]);
    await expect(lstat(join(cacheDir, "git", stale))).rejects.toMatchObject({ code: "ENOENT" });
    // Lock file is left alone (not a directory, sweep skips it)
    const lockStat = await lstat(join(cacheDir, "git", `${stale}.lock`));
    expect(lockStat.isFile()).toBe(true);
  });

  test("handles missing .cache/git/ gracefully (URL-only agent)", async () => {
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    const stale = "1".repeat(64);
    await mkdir(cacheDir, { recursive: true }); // .cache exists, but no git/ subdir
    await writeFile(join(cacheDir, `${stale}.json`), "{}");
    await writeFile(join(cacheDir, `${stale}.bin`), "s");

    const result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set());

    expect(result.removedGit).toEqual([]);
    expect(result.removedUrl.sort()).toEqual([`${stale}.bin`, `${stale}.json`]);
    expect(result.warnings).toEqual([]);
  });

  test("surfaces a warning (does not throw) when rm fails on an orphan dir", async () => {
    // chmod-based permission denial is a no-op for root, so this test would
    // pass-by-accident in a root container (e.g. some CI sandboxes). Skip
    // rather than report a false green.
    if (process.getuid?.() === 0) {
      return;
    }
    const root = await makeTmp();
    const cacheDir = join(root, ".cache");
    const stale = "2".repeat(64);
    const orphanDir = join(cacheDir, "git", stale);
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "child"), "c");

    // Make the orphan dir's PARENT (cacheDir/git) read+execute only (no write)
    // so rm of the orphan fails with EACCES. Restore in finally to allow cleanup.
    const parentDir = join(cacheDir, "git");
    const { chmod } = await import("node:fs/promises");
    await chmod(parentDir, 0o555);

    let result: Awaited<ReturnType<typeof sweepStaleCacheEntries>>;
    try {
      result = await sweepStaleCacheEntries(cacheDir, new Set(), new Set());
    } finally {
      await chmod(parentDir, 0o755); // restore so afterEach rm can clean up
    }

    expect(result.removedGit).toEqual([]); // rm failed, so not "removed"
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain(stale);
    expect(result.warnings[0]).toContain("cache cleanup failed");
  });
});
