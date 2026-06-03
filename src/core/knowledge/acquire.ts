import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  type AtlassianAuth,
  basicAuthHeader,
  resolveAtlassianAuth,
  tokenCreationInstructions,
} from "../../io/atlassian-auth";
import {
  type ConfluenceFetchOpts,
  type ConfluenceFetchResult,
  fetchConfluencePages,
} from "../../io/confluence";
import { httpErrorFor } from "../../io/http-error";
import { type JiraSearchOpts, searchJiraIssues } from "../../io/jira";
import { stateHome } from "../../io/state-home";
import { redactSecrets } from "../redact";
import { SmithError } from "../smith-error";

// ---------- git spawner (DI for tests) ----------

export interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Callable used by `acquireGit` to invoke git. Tests stub this; production
 * code uses `defaultGitSpawner` (which wraps `Bun.spawn`).
 *
 * `cwd` is the working directory for the git command. For `git clone` we pass
 * the cache parent dir so git interprets relative target paths sensibly; for
 * subsequent commands inside the cloned repo we pass the repo dir itself.
 */
export type GitSpawner = (args: string[], cwd: string) => Promise<GitRunResult>;

/**
 * Default GitSpawner used in production. Wraps `Bun.spawn`, which inherits the
 * parent process's environment by default — that is how git acquires the user's
 * SSH agent socket, credential helper config, `gh auth` state, and so on
 * without smith setting anything explicitly.
 *
 * If we ever need to scrub or extend env vars, do it here (or pass an explicit
 * `env` to `Bun.spawn`).
 */
export const defaultGitSpawner: GitSpawner = async (args, cwd) => {
  return runGitWith((cmd, opts) => Bun.spawn(cmd, opts), args, cwd);
};

/**
 * Internal helper exposed for testing. Wraps a `spawn`-like function and
 * translates ENOENT into a clear "git not installed" error. Production code
 * uses this with `Bun.spawn`; tests pass a stub that simulates the
 * not-installed case without mutating PATH.
 */
export async function runGitWith(
  spawnFn: (
    cmd: string[],
    opts: { cwd: string; stdout: "pipe"; stderr: "pipe" },
  ) => {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
  },
  args: string[],
  cwd: string,
): Promise<GitRunResult> {
  let proc: ReturnType<typeof spawnFn>;
  try {
    proc = spawnFn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new SmithError({
        code: "not-found",
        what: "executable",
        identifier: "git",
        suggestedCommand: "Install git via your package manager",
      });
    }
    throw err;
  }
  const exitCode = await proc.exited;
  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    code: exitCode,
  };
}

/**
 * One acquired artifact ready for materialization. `relPath` uses POSIX separators
 * (forward slashes) so it round-trips through manifest/glob matching consistently.
 */
export interface AcquiredArtifact {
  /** Logical filename for materializer hinting and manifest entry. */
  filename: string;
  /** POSIX-relative path within the source's logical root. For single-file sources, equals `filename`. */
  relPath: string;
  bytes: Buffer;
  /** Optional content-type (set by URL acquirer; undefined for local). */
  contentType?: string;
}

export interface DirOptions {
  include?: string[];
  exclude?: string[];
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

export async function acquireFile(absPath: string): Promise<AcquiredArtifact[]> {
  const bytes = await readFile(absPath);
  const filename = basename(absPath);
  return [{ filename, relPath: filename, bytes }];
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await recurse(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await recurse(root);
  return out;
}

export async function acquireDir(
  absPath: string,
  options: DirOptions = {},
): Promise<AcquiredArtifact[]> {
  const st = await stat(absPath);
  if (!st.isDirectory()) {
    throw new SmithError({
      code: "validation-failed",
      what: "directory source",
      reasons: [`${absPath} is not a directory`],
    });
  }
  const files = await walk(absPath);
  const includeMatch = options.include?.length ? picomatch(options.include) : () => true;
  const excludeMatch = options.exclude?.length ? picomatch(options.exclude) : () => false;
  const out: AcquiredArtifact[] = [];
  for (const f of files) {
    const rel = toPosix(relative(absPath, f));
    if (!includeMatch(rel)) continue;
    if (excludeMatch(rel)) continue;
    const bytes = await readFile(f);
    out.push({ filename: basename(f), relPath: rel, bytes });
  }
  // Deterministic order
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export async function acquireGlob(pattern: string, cwd: string): Promise<AcquiredArtifact[]> {
  const all = await walk(cwd);
  const match = picomatch(pattern);
  const out: AcquiredArtifact[] = [];
  for (const f of all) {
    const rel = toPosix(relative(cwd, f));
    if (!match(rel)) continue;
    const bytes = await readFile(f);
    out.push({ filename: basename(f), relPath: rel, bytes });
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

interface UrlCacheEntry {
  etag?: string;
  lastModified?: string;
  contentType?: string;
}

/**
 * Deterministic hex digest used as the on-disk directory name for a cached
 * git checkout. Defined here (next to `acquireGit`, which is the canonical
 * writer) so the knowledge pipeline can derive the same path without
 * coupling to `acquireGit` internals.
 *
 * Stable contract: `<cacheDir>/git/<urlCacheKey(url)>/` is the cloned tree.
 */
export function urlCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export function filenameFromUrl(url: string, contentType?: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = "/index";
  }
  let last = pathname.split("/").filter(Boolean).pop() ?? "index";
  if (!last.includes(".")) {
    if (contentType?.includes("html")) last += ".html";
    else if (contentType?.includes("json")) last += ".json";
    else if (contentType?.includes("markdown")) last += ".md";
    else if (contentType?.includes("pdf")) last += ".pdf";
    else last += ".txt";
  }
  return last;
}

export interface AcquireUrlOpts {
  /** When 'atlassian', injects Basic auth header from resolveAtlassianAuth(). */
  auth?: "atlassian" | "none";
  /** Override resolver for tests. */
  resolveAuth?: () => AtlassianAuth | null;
}

export async function acquireUrl(
  url: string,
  cacheDir: string,
  opts: AcquireUrlOpts = {},
): Promise<AcquiredArtifact[]> {
  await mkdir(cacheDir, { recursive: true });
  const key = urlCacheKey(url);
  const metaPath = join(cacheDir, `${key}.json`);
  const bodyPath = join(cacheDir, `${key}.bin`);

  let meta: UrlCacheEntry | undefined;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8")) as UrlCacheEntry;
  } catch {
    meta = undefined;
  }

  const headers: Record<string, string> = {};
  if (meta?.etag) headers["if-none-match"] = meta.etag;
  if (meta?.lastModified) headers["if-modified-since"] = meta.lastModified;

  if (opts.auth === "atlassian") {
    const resolver = opts.resolveAuth ?? resolveAtlassianAuth;
    const auth = resolver();
    if (!auth) {
      const head =
        `Atlassian credentials not configured. Create ${join(stateHome(), ".env")} with ` +
        "SMITH_ATLASSIAN_EMAIL and SMITH_ATLASSIAN_API_TOKEN.";
      throw new SmithError({
        code: "usage-error",
        message: [head, "", ...tokenCreationInstructions()].join("\n"),
      });
    }
    headers["Authorization"] = basicAuthHeader(auth);
  }

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new SmithError({
      code: "network-error",
      operation: "fetch",
      url: redactSecrets(url),
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (res.status === 304 && meta) {
    const cached = await readFile(bodyPath);
    const filename = filenameFromUrl(url, meta.contentType);
    return [
      {
        filename,
        relPath: filename,
        bytes: cached,
        ...(meta.contentType ? { contentType: meta.contentType } : {}),
      },
    ];
  }

  if (!res.ok) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      host = "url";
    }
    throw await httpErrorFor(res, {
      service: host,
      url,
      operation: "GET",
    });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? undefined;
  const newMeta: UrlCacheEntry = {};
  const etag = res.headers.get("etag");
  if (etag) newMeta.etag = etag;
  const lm = res.headers.get("last-modified");
  if (lm) newMeta.lastModified = lm;
  if (ct) newMeta.contentType = ct;
  await writeFile(bodyPath, buf);
  await writeFile(metaPath, JSON.stringify(newMeta));

  const filename = filenameFromUrl(url, ct);
  return [{ filename, relPath: filename, bytes: buf, ...(ct ? { contentType: ct } : {}) }];
}

// ---------- acquireGit ----------

export interface AcquireGitOpts {
  /** Repo URL (ssh or https). Required. */
  url: string;
  /** Branch, tag, or SHA. If omitted, clones default branch (no --branch flag). */
  ref?: string;
  /** Optional path within the repo to constrain scanning. */
  subpath?: string;
  /** Optional include glob patterns applied to the (subpath-rooted) file list. */
  include?: string[];
  /** Cache root for all git acquires. Per-URL subdir is created underneath. */
  cacheDir: string;
  /** DI hook for tests. Defaults to `defaultGitSpawner`. */
  spawner?: GitSpawner;
  /**
   * Optional warning sink. `acquireGit` invokes it for non-fatal conditions
   * (e.g. include-glob matches zero files). The pipeline wires this to the
   * per-source warning channel.
   */
  onWarning?: (message: string) => void;
}

/**
 * Clone (or refresh) a git repo into `<cacheDir>/git/<sha256(url)>/` and return
 * its files as `AcquiredArtifact[]`.
 *
 * Strategy:
 *  - First fetch: `git clone --depth=1 [--branch=<ref>] <url> <target>`.
 *  - Subsequent fetch with branch ref: `git fetch origin <ref>` + `git reset --hard origin/<ref>`.
 *  - Subsequent fetch with tag/sha ref (or no ref): no-op (immutable) when rev-parse fails.
 *
 * Concurrency: clone/refresh is serialized per-URL via an exclusive lock at
 * `<cacheDir>/git/<sha256(url)>.lock` (created with O_EXCL). Concurrent calls
 * for the same URL poll every 100ms for up to 30s waiting on the lock; on
 * acquisition the lock is released after the clone or refresh completes
 * (success or failure). Different URLs do not contend.
 *
 * Auth: NONE. Git inherits the user's environment (SSH keys, credential helper,
 * `gh auth`). If clone fails with an auth error, we surface git's stderr
 * verbatim so the user sees the real reason.
 */
export async function acquireGit(opts: AcquireGitOpts): Promise<AcquiredArtifact[]> {
  const spawner = opts.spawner ?? defaultGitSpawner;
  const cacheRoot = join(opts.cacheDir, "git");
  const repoKey = urlCacheKey(opts.url);
  const repoDir = join(cacheRoot, repoKey);
  const lockPath = join(cacheRoot, `${repoKey}.lock`);

  // Validate subpath BEFORE any I/O — traversal check is purely string-based,
  // so we can fail fast on bad input without spending time on a clone we'll
  // throw away. (See acquire-git.test.ts "rejects subpath that escapes...".)
  if (opts.subpath) {
    const resolvedRepo = resolve(repoDir);
    const resolvedScan = resolve(join(repoDir, opts.subpath));
    if (resolvedScan !== resolvedRepo && !resolvedScan.startsWith(resolvedRepo + sep)) {
      throw new SmithError({
        code: "validation-failed",
        what: "git source subpath",
        reasons: [`subpath must not escape repository root (got "${opts.subpath}")`],
      });
    }
  }

  await mkdir(cacheRoot, { recursive: true });

  await withRepoLock(
    lockPath,
    async () => {
      let exists = false;
      try {
        // `.git` may be either a directory (normal clone) OR a regular file
        // (gitlink — used by submodules and `git worktree add` checkouts). Both
        // forms mean "this dir is a git working tree". If we treat the gitlink
        // case as not-cloned we'd try to clone again, and clone would fail
        // because the target directory is not empty.
        await stat(join(repoDir, ".git"));
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        await cloneRepo(spawner, opts.url, opts.ref, repoDir, cacheRoot);
      } else {
        await refreshRepo(spawner, opts.ref, repoDir);
      }
    },
    opts.onWarning,
  );

  const scanRoot = opts.subpath ? join(repoDir, opts.subpath) : repoDir;
  let scanRootStat: Awaited<ReturnType<typeof stat>>;
  try {
    scanRootStat = await stat(scanRoot);
  } catch {
    if (opts.subpath) {
      const topLevel = await listTopLevel(repoDir);
      throw new SmithError({
        code: "not-found",
        what: "git subpath",
        identifier: opts.subpath,
        suggestedCommand: `Top-level entries in repo: ${topLevel.join(", ") || "(empty)"}`,
      });
    }
    throw new SmithError({
      code: "validation-failed",
      what: "git clone result",
      reasons: [`scan root ${scanRoot} not found after clone`],
    });
  }
  if (!scanRootStat.isDirectory()) {
    throw new SmithError({
      code: "validation-failed",
      what: "git source subpath",
      reasons: [`subpath "${opts.subpath}" is not a directory`],
    });
  }

  const files = await walkExcludingGit(scanRoot, repoDir);
  const matches = opts.include?.length ? picomatch(opts.include) : () => true;

  const out: AcquiredArtifact[] = [];
  for (const f of files) {
    const rel = toPosix(relative(scanRoot, f));
    if (!matches(rel)) continue;
    const bytes = await readFile(f);
    out.push({ filename: basename(f), relPath: rel, bytes });
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));

  if (out.length === 0 && opts.include?.length) {
    opts.onWarning?.(
      `include patterns [${opts.include.join(", ")}] matched zero files in ${opts.subpath ? `subpath "${opts.subpath}"` : "repo"}`,
    );
  }

  return out;
}

async function cloneRepo(
  spawner: GitSpawner,
  url: string,
  ref: string | undefined,
  target: string,
  cwd: string,
): Promise<void> {
  const args = ["clone", "--depth=1"];
  if (ref) args.push(`--branch=${ref}`);
  args.push(url, target);
  const result = await spawner(args, cwd);
  if (result.code !== 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "git clone",
      reasons: [
        `clone failed (exit ${result.code}) for ${redactSecrets(url)}${ref ? ` @ ${ref}` : ""}`,
        result.stderr.trim(),
      ].filter((r) => r.length > 0),
    });
  }
}

async function refreshRepo(
  spawner: GitSpawner,
  ref: string | undefined,
  repoDir: string,
): Promise<void> {
  let isBranch: boolean;
  if (!ref) {
    isBranch = true;
  } else {
    const probe = await spawner(["rev-parse", "--verify", `origin/${ref}`], repoDir);
    isBranch = probe.code === 0;
  }
  if (!isBranch) {
    return;
  }

  const fetchArgs = ref ? ["fetch", "origin", ref] : ["fetch", "origin"];
  const fetched = await spawner(fetchArgs, repoDir);
  if (fetched.code !== 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "git fetch",
      reasons: [`fetch failed (exit ${fetched.code}) in ${repoDir}`, fetched.stderr.trim()].filter(
        (r) => r.length > 0,
      ),
    });
  }

  const resetTarget = ref ? `origin/${ref}` : "origin/HEAD";
  const reset = await spawner(["reset", "--hard", resetTarget], repoDir);
  if (reset.code !== 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "git reset",
      reasons: [
        `reset --hard ${resetTarget} failed (exit ${reset.code}) in ${repoDir}`,
        reset.stderr.trim(),
      ].filter((r) => r.length > 0),
    });
  }
}

async function listTopLevel(repoDir: string): Promise<string[]> {
  try {
    const entries = await readdir(repoDir, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== ".git")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Walk `root` recursively, returning absolute paths of regular files. Skips
 * the repo's `.git` directory.
 *
 * Symlink handling: silently skipped. `Dirent.isFile()` and `Dirent.isDirectory()`
 * both return false for symlinks (they would only return true if we explicitly
 * followed the link with `stat`). We deliberately do not follow symlinks —
 * doing so would risk traversing outside the repo or hitting cycles. If a
 * source needs symlinked content materialized, link the target into the
 * checkout under a real path.
 */
async function walkExcludingGit(root: string, repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const gitDir = join(repoRoot, ".git");
  async function recurse(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (p === gitDir) continue;
      if (e.isDirectory()) await recurse(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await recurse(root);
  return out;
}

const LOCK_POLL_MS = 100;
const LOCK_TIMEOUT_MS = 30_000;
/**
 * If a lock file is older than this, assume the holder crashed and the lock
 * is stale. Conservative default — a clone takes a few seconds for normal
 * repos, several minutes for huge ones. 5 minutes is well beyond a healthy
 * clone but still recovers in the same session for ergonomics.
 */
const LOCK_STALE_MS = 5 * 60 * 1000;

/**
 * Acquire an exclusive file-based lock for the duration of `fn`. Uses
 * `open(path, 'wx')` so that lock creation fails atomically when another
 * process/caller already holds it; we then poll every LOCK_POLL_MS up to
 * LOCK_TIMEOUT_MS. The lock file is unlinked on release (success or failure).
 *
 * Stale-lock recovery: on EEXIST we stat the existing lock; if its mtime is
 * older than LOCK_STALE_MS we assume a previous holder crashed, log a warning,
 * unlink the lock, and retry. We deliberately do not wait for staleness during
 * the poll — we re-check on every iteration so a fresh lock that ages past the
 * threshold while we wait is still recovered eventually. We do NOT touch a
 * fresh lock; that would race with a legitimate slow clone.
 */
async function withRepoLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  onWarning?: (message: string) => void,
): Promise<T> {
  const start = Date.now();
  // Try to acquire the lock, polling on contention.
  // Note: `open(... 'wx')` rejects with EEXIST if the file already exists.
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      // Stale-lock recovery: check the existing lock's age. If it's older
      // than LOCK_STALE_MS, the holder almost certainly crashed; remove and
      // retry on the next iteration.
      try {
        const lockStat = await stat(lockPath);
        const age = Date.now() - lockStat.mtimeMs;
        if (age > LOCK_STALE_MS) {
          // CORE-18: route through the caller's warning channel so the
          // orchestrator's `[<source-id>]` prefix and structured collection
          // apply. Fall back to `console.warn` when no callback was provided.
          const message = `acquireGit: removing stale lock ${lockPath} (age ${Math.round(age / 1000)}s > ${LOCK_STALE_MS / 1000}s threshold)`;
          if (onWarning) onWarning(message);
          else console.warn(message);
          await rm(lockPath, { force: true });
          // Loop around immediately and try to acquire.
          continue;
        }
      } catch {
        // Lock vanished between EEXIST and stat — race with another caller
        // releasing it. Loop around and retry the open.
        continue;
      }

      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new SmithError({
          code: "validation-failed",
          what: "git repo lock",
          reasons: [
            `Timed out after ${LOCK_TIMEOUT_MS}ms waiting for lock ${lockPath}`,
            "Another process may be cloning the same repo, or a stale lock remains",
          ],
          suggestedCommand: `If stuck: rm ${lockPath}`,
        });
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Confluence acquirer. Returns artifacts and warnings (e.g. cap-hit). The pipeline
 * is responsible for collecting warnings into its result.
 */
export async function acquireConfluence(opts: ConfluenceFetchOpts): Promise<ConfluenceFetchResult> {
  return fetchConfluencePages(opts);
}

/**
 * Jira acquirer. Returns one artifact per issue.
 */
export async function acquireJira(opts: JiraSearchOpts): Promise<AcquiredArtifact[]> {
  return searchJiraIssues(opts);
}
