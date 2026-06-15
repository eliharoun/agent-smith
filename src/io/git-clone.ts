// src/io/git-clone.ts
//
// Shared git clone + fetch primitive used by both:
//   - core/knowledge/acquire.ts (transient cache under <cacheRoot>/git/<hash>/)
//   - cli external-repo install (persistent under <stateHome>/remote/...)
//
// The caller supplies the targetDir. We don't pick paths — that's policy and
// lives in the call site. We just clone, fetch, reset.
//
// The fetch path is added in v1-task C3.3.
//
// All git is spawned through the shared hardened `runGit` chokepoint in
// ./git, which prepends `git` + the transport allowlist (C4.0.4), sets the
// non-interactive env (GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS=""), and maps
// ENOENT → SmithError. We only own the high-level clone/fetch policy here.

import { createHash } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitOperationError } from "../core/git-error-mapper";
import { SmithError } from "../core/smith-error";
import { runGit, type GitSpawnFn } from "./git";
import { withFileLock } from "./git-lock";

export interface CloneOrFetchOptions {
  url: string;
  ref: string;
  targetDir: string;
  /** Test-only spawn seam, threaded into runGit. Production uses Bun.spawn. */
  spawnFn?: GitSpawnFn;
}

export interface CloneOrFetchResult {
  sha: string;
  /** true if we fetched into an existing checkout, false if we cloned fresh. */
  fetched: boolean;
}

export async function cloneOrFetch(opts: CloneOrFetchOptions): Promise<CloneOrFetchResult> {
  // C4.0.3: serialize concurrent clone/fetch against the same target dir.
  // Lock file lives next to the target (siblings inside dirname(targetDir))
  // so the lock dir exists independently of whether the clone has happened
  // yet. Lock name is keyed on targetDir basename — same target collides,
  // different targets run concurrently.
  await mkdir(dirname(opts.targetDir), { recursive: true });
  const lockName = `.${urlLockKey(opts.targetDir).slice(0, 16)}.lock`;
  const lockPath = join(dirname(opts.targetDir), lockName);
  return withFileLock(lockPath, () => cloneOrFetchInner(opts));
}

async function cloneOrFetchInner(opts: CloneOrFetchOptions): Promise<CloneOrFetchResult> {
  // Only include spawnFn in the runGit opts when it's actually set —
  // `exactOptionalPropertyTypes` forbids passing an explicit `undefined`.
  const spawn: { spawnFn?: GitSpawnFn } = opts.spawnFn ? { spawnFn: opts.spawnFn } : {};
  const existing = await stat(join(opts.targetDir, ".git")).catch(() => null);
  if (existing?.isDirectory()) {
    // Fetch + reset to origin/<ref>. Destructive of local edits per spec §1.
    const fetchRes = await runGit(["fetch", "origin", opts.ref], opts.targetDir, spawn);
    if (fetchRes.code !== 0) {
      throw new SmithError(gitOperationError("fetch updates", opts.url, fetchRes.stderr));
    }
    // DW-7: choose the reset target based on the ref kind.
    //
    //   - For a branch name like "main", reset to `origin/main`. That
    //     remote-tracking ref is updated by `git fetch origin <branch>`
    //     and is the well-understood git idiom.
    //   - For the pseudo-ref "HEAD", we MUST reset to `FETCH_HEAD`,
    //     not `origin/HEAD`. `git fetch origin HEAD` populates
    //     `FETCH_HEAD` with the freshly-fetched remote tip, but it
    //     does NOT update `refs/remotes/origin/HEAD` — that symbolic
    //     ref is established at clone time and only refreshed by
    //     `git remote set-head` / `git remote show`. So resetting to
    //     `origin/HEAD` would silently put the working tree at the
    //     clone-time SHA forever; that was the root cause of DW-7
    //     ('agent sync' reported success while staying on the old
    //     commit for every remote-installed catalog, since they all
    //     default to ref:'HEAD').
    const resetTarget = opts.ref === "HEAD" ? "FETCH_HEAD" : `origin/${opts.ref}`;
    const resetRes = await runGit(["reset", "--hard", resetTarget], opts.targetDir, spawn);
    if (resetRes.code !== 0) {
      // SHA / tag refs aren't qualified with origin/<ref>; retry as plain ref.
      const retry = await runGit(["reset", "--hard", opts.ref], opts.targetDir, spawn);
      if (retry.code !== 0) {
        throw new SmithError(gitOperationError(`reset to ${opts.ref}`, opts.url, retry.stderr));
      }
    }
    const head = await runGit(["rev-parse", "HEAD"], opts.targetDir, spawn);
    if (head.code !== 0) {
      throw new SmithError(gitOperationError("resolve commit", opts.url, head.stderr));
    }
    return { sha: head.stdout.trim(), fetched: true };
  }

  // Clone path.
  await mkdir(dirname(opts.targetDir), { recursive: true });
  const cloneRes = await runGit(
    ["clone", "--branch", opts.ref, opts.url, opts.targetDir],
    dirname(opts.targetDir),
    spawn,
  );
  if (cloneRes.code !== 0) {
    // Some refs (SHAs) can't be passed to --branch. Retry without it.
    await rm(opts.targetDir, { recursive: true, force: true });
    const fallback = await runGit(
      ["clone", opts.url, opts.targetDir],
      dirname(opts.targetDir),
      spawn,
    );
    if (fallback.code !== 0) {
      throw new SmithError(
        gitOperationError("clone repository", opts.url, cloneRes.stderr || fallback.stderr),
      );
    }
    const co = await runGit(["checkout", opts.ref], opts.targetDir, spawn);
    if (co.code !== 0) {
      throw new SmithError(gitOperationError(`checkout ${opts.ref}`, opts.url, co.stderr));
    }
  }
  const head = await runGit(["rev-parse", "HEAD"], opts.targetDir, spawn);
  if (head.code !== 0) {
    throw new SmithError(gitOperationError("resolve commit", opts.url, head.stderr));
  }
  return { sha: head.stdout.trim(), fetched: false };
}

/** SHA256 of url — used by callers to pick a stable lock-file name. */
export function urlLockKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/**
 * Resolve the current SHA of `ref` at the remote without cloning or
 * fetching. Used by `smith {agent,skill} sync --check` to record the
 * remote tip in `lastRemoteSha` without disturbing the working tree.
 *
 * Throws on non-zero exit or malformed output. `ref` may be any value
 * `git ls-remote` accepts (branch, tag, or pseudo-ref like `HEAD`).
 */
export async function lsRemoteHead(opts: {
  url: string;
  ref: string;
  spawnFn?: GitSpawnFn;
}): Promise<string> {
  const spawn: { spawnFn?: GitSpawnFn } = opts.spawnFn ? { spawnFn: opts.spawnFn } : {};
  const res = await runGit(["ls-remote", opts.url, opts.ref], process.cwd(), spawn);
  if (res.code !== 0) {
    throw new SmithError(gitOperationError("query remote", opts.url, res.stderr));
  }
  const firstLine = res.stdout.split("\n")[0] ?? "";
  const sha = firstLine.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new SmithError(
      gitOperationError("query remote", opts.url, `malformed sha: ${sha || "(empty)"}`),
    );
  }
  return sha;
}
