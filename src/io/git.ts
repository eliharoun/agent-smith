export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type Runner = (args: string[]) => Promise<RunResult>;

import { isDebug } from "../cli/debug-flag";

/**
 * Outcome of {@link pullIfClean}. Discriminated by `status` so callers
 * can switch exhaustively without inspecting strings.
 *
 * - `clean`  — workspace was clean and the fast-forward pull succeeded.
 *   `output` is git's stdout (e.g. "Already up to date." or merge summary).
 * - `dirty`  — workspace had uncommitted changes (tracked or staged); no
 *   pull attempted. `porcelain` is the raw `git status --porcelain` output
 *   so callers can show users exactly what's blocking.
 * - `error`  — `git status` or `git pull` failed for some other reason
 *   (network, bad ref, broken repo, etc.). `message` is a human-readable
 *   explanation suitable for end-user display.
 */
export type PullResult =
  | { status: "clean"; output: string }
  | { status: "dirty"; porcelain: string }
  | { status: "error"; message: string };

/**
 * Outcome of a one-shot git query helper. Discriminated by `ok` so callers
 * can switch exhaustively, and `reason` distinguishes the failure modes
 * we surface in user-facing reports:
 *
 * - `exit-code` — git itself returned non-zero (network, bad ref, etc.).
 *   `detail` carries the trimmed stderr.
 * - `empty`     — git exited 0 but produced no usable output (e.g.
 *   `ls-remote` against a remote with no HEAD).
 * - `parse`     — output existed but was not in the expected format
 *   (e.g. `rev-list --count` returned non-numeric text).
 */
export type GitResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "exit-code" | "empty" | "parse"; detail?: string };

export function defaultRunner(cwd: string): Runner {
  return async (args) => {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return {
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
      code,
    };
  };
}

export interface GitDeps {
  runner?: Runner;
}

export async function pullIfClean(cwd: string, deps?: GitDeps): Promise<PullResult> {
  const r = deps?.runner ?? defaultRunner(cwd);
  const status = await r(["status", "--porcelain"]);
  if (status.code !== 0) {
    return { status: "error", message: `git status failed: ${status.stderr.trim()}` };
  }
  if (status.stdout.trim().length > 0) {
    return { status: "dirty", porcelain: status.stdout };
  }
  const pull = await r(["pull", "--ff-only"]);
  if (pull.code !== 0) {
    const stderr = pull.stderr.trim();
    let prefix = "";
    if (/fast.forward|not a fast-forward/i.test(stderr)) {
      prefix =
        "Fast-forward not possible — your local branch has diverged. Stash or rebase first.\n";
    } else if (/no upstream/i.test(stderr)) {
      prefix =
        "Branch has no upstream configured. Run `git branch --set-upstream-to=origin/main`.\n";
    } else if (/authentication|could not read username|terminal prompts disabled/i.test(stderr)) {
      prefix =
        "Git authentication failed or required an interactive prompt. Configure credentials (e.g. git credential helper or SSH).\n";
    }
    return { status: "error", message: `${prefix}git pull failed: ${stderr}` };
  }
  return { status: "clean", output: pull.stdout };
}

/**
 * Look up the SHA of a remote's HEAD without fetching. Returns a
 * GitResult so callers can distinguish exit-code failures (network,
 * no remote) from an empty stdout (no remote HEAD).
 */
export async function lsRemote(
  cwd: string,
  remote: string,
  deps?: GitDeps,
): Promise<GitResult<string>> {
  const r = deps?.runner ?? defaultRunner(cwd);
  const result = await r(["ls-remote", remote, "HEAD"]);
  if (result.code !== 0) {
    return { ok: false, reason: "exit-code", detail: result.stderr.trim() };
  }
  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!sha || sha.length === 0) {
    return { ok: false, reason: "empty" };
  }
  return { ok: true, value: sha };
}

/**
 * Resolve a ref to its SHA. Returns a GitResult discriminating
 * exit-code failure from empty output.
 */
export async function revParse(
  cwd: string,
  ref: string,
  deps?: GitDeps,
): Promise<GitResult<string>> {
  const r = deps?.runner ?? defaultRunner(cwd);
  const result = await r(["rev-parse", ref]);
  if (result.code !== 0) {
    return { ok: false, reason: "exit-code", detail: result.stderr.trim() };
  }
  const sha = result.stdout.trim();
  if (sha.length === 0) {
    return { ok: false, reason: "empty" };
  }
  return { ok: true, value: sha };
}

/**
 * Count commits in a revision range (e.g. "HEAD..origin/main"). Returns
 * a GitResult: exit-code on failure, empty when stdout is blank, parse
 * when the output isn't a non-negative integer.
 */
export async function revListCount(
  cwd: string,
  range: string,
  deps?: GitDeps,
): Promise<GitResult<number>> {
  const r = deps?.runner ?? defaultRunner(cwd);
  const result = await r(["rev-list", "--count", range]);
  if (result.code !== 0) {
    return { ok: false, reason: "exit-code", detail: result.stderr.trim() };
  }
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: "parse", detail: trimmed };
  }
  return { ok: true, value: n };
}

/**
 * Best-effort: read a repo's `origin` remote URL via `git remote get-url
 * origin`. Returns `undefined` on any failure (git binary missing, not a
 * git repo, no `origin`, empty stdout, timeout, non-zero exit). Never
 * throws — intended for opportunistic enrichment of a Source where the
 * absence of a remote should not abort the caller.
 *
 * The default runner enforces a 2s timeout via AbortSignal so a hung git
 * (e.g. credential helper waiting on a TTY) cannot block source
 * enumeration. Tests inject `deps.runner` to stub the call entirely; the
 * timeout only applies to the default runner.
 */
export async function getOriginRemote(
  cwd: string,
  deps?: GitDeps,
): Promise<string | undefined> {
  const r = deps?.runner ?? timedDefaultRunner(cwd, 2000);
  try {
    const result = await r(["remote", "get-url", "origin"]);
    if (result.code !== 0) {
      if (isDebug()) {
        console.error(
          `[smith debug] getOriginRemote failed: exit ${result.code} ${result.stderr.trim()}`,
        );
      }
      return undefined;
    }
    const url = result.stdout.trim();
    if (url.length === 0) {
      if (isDebug()) {
        console.error(`[smith debug] getOriginRemote failed: empty stdout`);
      }
      return undefined;
    }
    return url;
  } catch (err) {
    if (isDebug()) {
      console.error(
        `[smith debug] getOriginRemote failed: ${(err as Error).message}`,
      );
    }
    return undefined;
  }
}

/**
 * Like {@link defaultRunner} but cancels the spawned git process after
 * `timeoutMs` via AbortSignal. Used by {@link getOriginRemote} to bound
 * a possibly-hanging git invocation; not exported because the timeout
 * semantics are specific to opportunistic helpers.
 */
function timedDefaultRunner(cwd: string, timeoutMs: number): Runner {
  return async (args) => {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const code = await proc.exited;
    return {
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
      code,
    };
  };
}
