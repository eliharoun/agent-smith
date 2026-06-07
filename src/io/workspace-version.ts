import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDebug } from "../cli/debug-flag";
import type { GitDeps, Runner } from "./git";
import { lsRemote, revListCount, revParse } from "./git";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * The accepted package name when walking up from a source file looking for
 * the agent-smith workspace. Single entry under the single-mode install
 * (Batch 17): every clone comes from eliharoun/agent-smith with
 * `name: "agent-smith"` in package.json. The legacy scoped name
 * `@eliharoun/agent-smith` (pre-0.7.0) is no longer reachable because
 * `bin/install` is the only supported install path and it clones the
 * canonical repo.
 */
// Both names are recognized: source clones / dev installs use "agent-smith"
// (the original git-tree package.json), npm-published tarballs use
// "@eliharoun/agent-smith" (the npm registry name; the CLI binary is
// still "smith"). The npm scoped name avoids npm's name-similarity check
// against an existing unscoped `agentsmith` package.
const WORKSPACE_PKG_NAMES = new Set(["agent-smith", "@eliharoun/agent-smith"]);

/**
 * Walk up from a source file path looking for a package.json whose `name`
 * field identifies the agent-smith workspace. Returns the directory containing
 * that package.json, or null if not found before reaching the filesystem root.
 *
 * Used to anchor `smith update` and the doctor staleness check to the
 * agent-smith repo regardless of the user's cwd.
 */
export async function resolveWorkspacePath(sourceFilePath: string): Promise<string | null> {
  let dir = dirname(sourceFilePath);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    const f = Bun.file(pkgPath);
    if (await f.exists()) {
      try {
        const pkg = (await f.json()) as { name?: string };
        if (pkg.name && WORKSPACE_PKG_NAMES.has(pkg.name)) return dir;
      } catch (err) {
        // malformed package.json — keep walking up
        if (isDebug()) {
          console.error(
            `[smith debug] skipped malformed package.json at ${pkgPath}: ${(err as Error).message}`,
          );
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

export type WorkspaceVersionStatus =
  | { status: "current" }
  | { status: "behind"; commitsBehind: number | null }
  | { status: "ahead"; commitsAhead: number | null }
  | { status: "diverged"; commitsBehind: number; commitsAhead: number }
  | {
      status: "unknown";
      reason:
        | "network-error"
        | "empty-remote"
        | "no-local-head"
        | "empty-local-head"
        | "non-git"
        | "no-workspace"
        | "offline-skipped";
    };

/**
 * Compare the workspace's local HEAD to its remote (origin) HEAD without
 * fetching. Returns a structured status:
 *
 *   - "current":  local == upstream
 *   - "behind":   origin has commits we don't have
 *   - "ahead":    we have commits not in origin (e.g. feature branch)
 *   - "diverged": both directions have unique commits
 *   - "unknown":  one of the git operations failed (caller decides display)
 *
 * Commit counts are best-effort: HEAD..origin/main and origin/main..HEAD
 * are both counted; if either fails (e.g. user hasn't fetched origin/main)
 * we degrade gracefully — "behind"/"ahead" with a null count, or fall back
 * to "behind" if both directions failed.
 *
 * The caller injects a Runner for testability; the default runner uses
 * git in `cwd`.
 */
export async function checkWorkspaceVersion(
  cwd: string,
  runner?: Runner,
): Promise<WorkspaceVersionStatus> {
  const deps: GitDeps = runner ? { runner } : {};
  const upstream = await lsRemote(cwd, "origin", deps);
  if (!upstream.ok) {
    return {
      status: "unknown",
      reason: upstream.reason === "empty" ? "empty-remote" : "network-error",
    };
  }
  const local = await revParse(cwd, "HEAD", deps);
  if (!local.ok) {
    return {
      status: "unknown",
      reason: local.reason === "empty" ? "empty-local-head" : "no-local-head",
    };
  }
  if (local.value === upstream.value) return { status: "current" };
  // SHAs differ — figure out the relationship by counting both directions.
  // HEAD..origin/main = commits in origin not in local (i.e., commits we're behind).
  // origin/main..HEAD = commits in local not in origin (i.e., commits we're ahead).
  const behindRes = await revListCount(cwd, "HEAD..origin/main", deps);
  const aheadRes = await revListCount(cwd, "origin/main..HEAD", deps);
  const commitsBehind = behindRes.ok ? behindRes.value : null;
  const commitsAhead = aheadRes.ok ? aheadRes.value : null;

  // Both rev-lists failed: best-effort "behind, count unknown".
  if (commitsBehind === null && commitsAhead === null) {
    return { status: "behind", commitsBehind: null };
  }
  // Only ahead direction known.
  if (commitsBehind === null) {
    return { status: "ahead", commitsAhead };
  }
  // Only behind direction known.
  if (commitsAhead === null) {
    return { status: "behind", commitsBehind };
  }
  // Both known — discriminate.
  if (commitsBehind > 0 && commitsAhead > 0) {
    return { status: "diverged", commitsBehind, commitsAhead };
  }
  if (commitsBehind > 0) {
    return { status: "behind", commitsBehind };
  }
  if (commitsAhead > 0) {
    return { status: "ahead", commitsAhead };
  }
  // Both 0 with differing SHAs is impossible by definition (rev-list semantics),
  // but defensive fallback: report behind with 0 if it ever happens.
  return { status: "behind", commitsBehind: 0 };
}

/**
 * Convenience: derives the workspace path from the running source file's
 * import.meta.url and runs the version check. Returns 'unknown' with
 * reason 'no-workspace' when the agent-smith package.json can't be
 * located walking up (e.g. the CLI is invoked from a directory that
 * isn't inside the agent-smith workspace tree), or 'non-git' when
 * the workspace exists but has no .git directory.
 */
export async function checkRunningWorkspaceVersion(
  importMetaUrl: string,
  runner?: Runner,
): Promise<WorkspaceVersionStatus> {
  const sourcePath = fileURLToPath(importMetaUrl);
  const workspace = await resolveWorkspacePath(sourcePath);
  if (workspace === null) return { status: "unknown", reason: "no-workspace" };
  if (!(await pathExists(join(workspace, ".git")))) {
    return { status: "unknown", reason: "non-git" };
  }
  return checkWorkspaceVersion(workspace, runner);
}
