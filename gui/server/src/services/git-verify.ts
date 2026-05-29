import type { GitVerifyResult } from "gui-shared";
import { normalizeGitUrl } from "gui-shared";

export interface GitVerifyDeps {
  /** Inject for tests; default uses Bun.spawn. */
  spawnGit?: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
}

/**
 * Mirrors `verifyGitRemote` at `src/cli/registry-validation.ts:68-126`.
 *   1. `git -C <path> rev-parse --show-toplevel` — confirms a git repo.
 *   2. `git -C <path> remote -v` — list remotes.
 *   3. Compare expected URL (when provided) with trailing-slash and `.git`
 *      normalization, case-sensitive equality.
 */
export async function verifyGitRemote(
  path: string,
  expected: string | undefined,
  deps: GitVerifyDeps = {},
): Promise<GitVerifyResult> {
  const spawn = deps.spawnGit ?? defaultSpawnGit;
  const top = await spawn(["-C", path, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { ok: false, reason: "not-a-git-repo" };
  const rem = await spawn(["-C", path, "remote", "-v"]);
  if (rem.code !== 0) return { ok: false, reason: "not-a-git-repo" };
  const remotes = parseRemotes(rem.stdout);
  if (expected === undefined) {
    return { ok: true, skipped: false, remotes };
  }
  // Use the canonical normalizer so URL-shape variations (scheme,
  // trailing .git, case in host/owner/repo, SSH colon separator)
  // match the same way the root-package equivalent treats them.
  const want = normalizeGitUrl(expected);
  const matched = remotes.some((r) => normalizeGitUrl(r.url) === want);
  if (!matched) return { ok: false, reason: "remote-mismatch", found: remotes };
  return { ok: true, skipped: false, remotes };
}

function parseRemotes(out: string): { name: string; url: string }[] {
  const seen = new Map<string, string>();
  const re = /^([^\t]+)\t(\S+)\s+\((?:fetch|push)\)$/;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) seen.set(m[1]!, m[2]!);
  }
  return Array.from(seen, ([name, url]) => ({ name, url }));
}

async function defaultSpawnGit(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, code: proc.exitCode ?? 1 };
}
