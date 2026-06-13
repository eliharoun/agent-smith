import { lstat, mkdir, readdir, readlink, rename, rm, symlink, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { SmithError } from "../smith-error";

/**
 * Idempotently create a relative symlink at `linkPath` pointing at `targetPath`.
 *
 * The symlink stores a path relative to `dirname(linkPath)` so the entire
 * knowledge tree survives moves (e.g. user relocates `~/.config/agent-smith`).
 *
 * Behavior:
 * - Missing `linkPath` → creates parent dir, then symlink.
 * - `linkPath` exists as a symlink pointing at the same relative target → no-op.
 * - `linkPath` exists as a symlink pointing elsewhere → atomic replace via
 *   tmp+rename (safe under concurrent installs of the same agent).
 * - `linkPath` exists but is NOT a symlink (regular file, directory) → throws
 *   `SmithError({ code: "validation-failed" })`. Defensive: refuses to clobber
 *   whatever the user or an old install left there.
 *
 * IO failures (EACCES, EROFS, ENOSPC) bubble up. Callers are expected to
 * catch and downgrade to a warning.
 */
export async function ensureRelativeSymlink(linkPath: string, targetPath: string): Promise<void> {
  const relativeTarget = relative(dirname(linkPath), targetPath);

  let existing: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    existing = await lstat(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (!existing) {
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(relativeTarget, linkPath);
    return;
  }

  if (existing.isSymbolicLink()) {
    const current = await readlink(linkPath);
    if (current === relativeTarget) return;
    // Atomic replace: create tmp symlink, rename over.
    // hrtime.bigint() gives ns resolution (vs Date.now()'s ms) so concurrent
    // callers in the same process+ms window can't collide on the tmp path.
    const tmpPath = `${linkPath}.tmp-${process.pid}-${process.hrtime.bigint()}`;
    await symlink(relativeTarget, tmpPath);
    await rename(tmpPath, linkPath);
    return;
  }

  throw new SmithError({
    code: "validation-failed",
    what: "ensureRelativeSymlink",
    reasons: [`refusing to overwrite non-symlink at ${linkPath}`],
  });
}

/**
 * Remove symlinks from `<knowledgeDir>/repos/` whose id is no longer present
 * in `currentGitSourceIds`. Safe when `repos/` does not exist.
 *
 * Scope: symlinks only. Does not touch the underlying `.cache/git/<hash>/`
 * directories — that's the responsibility of `sweepStaleCacheEntries`,
 * which runs immediately after this in the pipeline. (Caches are strictly
 * per-agent, so no cross-agent GC is needed; see io/knowledge-paths.ts:22-24.)
 *
 * Defensive: if an entry in `repos/` is not a symlink (e.g. a stray file
 * or directory a user dropped in), it is NOT removed; a warning is returned
 * for the caller to surface.
 *
 * Dangling symlinks (target deleted out-of-band) are still removed when
 * their id is stale — the check is structural (symlink-ness + id-membership),
 * not based on target existence.
 */
export async function sweepStaleRepoSymlinks(
  knowledgeDir: string,
  currentGitSourceIds: Set<string>,
): Promise<{ removed: string[]; warnings: string[] }> {
  const reposDir = join(knowledgeDir, "repos");
  const removed: string[] = [];
  const warnings: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(reposDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { removed, warnings };
    }
    throw err;
  }

  for (const name of entries) {
    const entryPath = join(reposDir, name);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(entryPath);
    } catch {
      // Disappeared between readdir and lstat — treat as already-gone.
      continue;
    }
    if (!info.isSymbolicLink()) {
      warnings.push(`unexpected non-symlink in repos/: ${name}`);
      continue;
    }
    if (currentGitSourceIds.has(name)) continue;
    await unlink(entryPath);
    removed.push(name);
  }

  return { removed, warnings };
}

/**
 * Remove stale entries from `<agent>/.cache/`. Two phases:
 *
 * 1. **Git clones**: under `<cacheDir>/git/`, remove subdirectories whose
 *    name is a 64-hex hash NOT present in `currentGitKeys`. Non-directory
 *    entries (e.g. `.lock` files) and non-hash-shaped names are left alone.
 *
 * 2. **URL cache**: under `<cacheDir>/` itself, remove files matching
 *    `<64-hex>.json` or `<64-hex>.bin` whose hash prefix is NOT present in
 *    `currentUrlKeys`. The `git/` subdir is skipped (handled in phase 1);
 *    all other unknown entries are left alone (allowlist semantics).
 *
 * Allowlist-based: anything not recognized by name pattern is preserved.
 * Future cache types can be added without retroactively breaking existing
 * disk layouts.
 *
 * Failure isolation: per-entry IO errors (EACCES, EBUSY, EROFS, ENOSPC)
 * are caught and surfaced as warnings; the sweep continues with the next
 * entry. Never throws.
 *
 * Cache-key derivation is the caller's responsibility:
 *   currentGitKeys = sources.filter(s => s.type === "git").map(s => urlCacheKey(s.url))
 *   currentUrlKeys = sources.filter(s => s.type === "webpage").map(s => urlCacheKey(s.url))
 *
 * Build the key sets from DECLARED sources, not from successfully-processed
 * ones — a transient clone failure should preserve the cache for next run.
 */
export async function sweepStaleCacheEntries(
  cacheDir: string,
  currentGitKeys: Set<string>,
  currentUrlKeys: Set<string>,
): Promise<{ removedGit: string[]; removedUrl: string[]; warnings: string[] }> {
  const HASH = /^[0-9a-f]{64}$/;
  const URL_CACHE_FILE = /^([0-9a-f]{64})\.(json|bin)$/;

  const removedGit: string[] = [];
  const removedUrl: string[] = [];
  const warnings: string[] = [];

  // Phase 1: git clone sweep
  const gitDir = join(cacheDir, "git");
  let gitEntries: string[] | undefined;
  try {
    gitEntries = await readdir(gitDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`cache cleanup failed: cannot read ${gitDir}: ${(err as Error).message}`);
    }
    // ENOENT is fine — no git cache to sweep.
  }

  // Phase 1 and Phase 2 handle readdir failure asymmetrically:
  //   - Phase 1: warn and continue to Phase 2 (URL cache may still need sweeping)
  //   - Phase 2: warn and return (cache root unreadable = stop, nothing else to do)
  if (gitEntries !== undefined) {
    for (const name of gitEntries) {
      if (!HASH.test(name)) continue; // leave non-hash entries (e.g. .lock files) alone
      if (currentGitKeys.has(name)) continue;
      const entryPath = join(gitDir, name);
      let info: Awaited<ReturnType<typeof lstat>>;
      try {
        info = await lstat(entryPath);
      } catch {
        // Disappeared between readdir and lstat — already gone, no warning.
        continue;
      }
      if (!info.isDirectory()) continue; // hash-shaped name but not a dir — leave it
      try {
        await rm(entryPath, { recursive: true, force: true });
        removedGit.push(name);
      } catch (err) {
        warnings.push(`[${name}] cache cleanup failed: ${(err as Error).message}`);
      }
    }
  }

  // Phase 2: URL cache sweep
  let topEntries: string[] | undefined;
  try {
    topEntries = await readdir(cacheDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`cache cleanup failed: cannot read ${cacheDir}: ${(err as Error).message}`);
    }
    return { removedGit, removedUrl, warnings };
  }

  for (const name of topEntries) {
    if (name === "git") continue; // handled in phase 1
    const match = URL_CACHE_FILE.exec(name);
    if (!match) continue; // unknown entry — leave alone
    const hash = match[1] as string;
    if (currentUrlKeys.has(hash)) continue;
    const entryPath = join(cacheDir, name);
    try {
      await unlink(entryPath);
      removedUrl.push(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      warnings.push(`[${name}] cache cleanup failed: ${(err as Error).message}`);
    }
  }

  return { removedGit, removedUrl, warnings };
}
