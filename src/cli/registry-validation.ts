import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalizeGitUrl } from "../io/git-url";

export interface SniffResult {
  exists: boolean;
  /** Subdirectories of `path` that contain `agent.config.json`. */
  agentBundles: number;
  /** Subdirectories of `path` that contain `SKILL.md` AND no `agent.config.json`. */
  skillBundles: number;
  /**
   * Subdirectory names that look like leftover bundle scaffolding —
   * directories whose contents are empty (no `agent.config.json`, no
   * `SKILL.md`, no other entries). Common artifacts of aborted
   * `smith agent init` runs or manually created placeholder dirs.
   * Surfaced by `smith doctor` so the user can clean them up.
   */
  emptyBundleDirs: string[];
  /**
   * True when `path` itself is a single agent bundle (top-level
   * `agent.config.json`). This is the natural shape of a `git clone` of
   * a single-agent repo and is what the C-series remote install
   * (`src/core/install-from-url.ts`) registers. Independent of
   * `agentBundles` — a rootPath can be both a single-bundle AND a catalog
   * if it contains both a top-level config and sub-bundles. Mutually
   * exclusive with `isSingleSkillBundle` (agent wins, like the per-subdir
   * tie-break above).
   */
  isSingleAgentBundle: boolean;
  /**
   * True when `path` itself is a single skill bundle (top-level
   * `SKILL.md` and no top-level `agent.config.json`). Mirror of
   * `isSingleAgentBundle` for skills.
   */
  isSingleSkillBundle: boolean;
}

/**
 * Inspect `path` to classify what kind of registry entry it would make.
 * Used by `smith agent register` and `smith skill register` to reject
 * obviously-wrong inputs (missing path, empty path, wrong content type),
 * and by the doctor registry-hygiene check to confirm a registered
 * source actually contains bundles.
 *
 * Pure read-only filesystem inspection; never mutates.
 */
export async function sniffPath(path: string): Promise<SniffResult> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return {
      exists: false,
      agentBundles: 0,
      skillBundles: 0,
      emptyBundleDirs: [],
      isSingleAgentBundle: false,
      isSingleSkillBundle: false,
    };
  }

  const isSingleAgentBundle = await fileExists(join(path, "agent.config.json"));
  const isSingleSkillBundle = !isSingleAgentBundle && (await fileExists(join(path, "SKILL.md")));

  let agentBundles = 0;
  let skillBundles = 0;
  const emptyBundleDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = join(path, entry.name);
    const hasAgent = await fileExists(join(sub, "agent.config.json"));
    if (hasAgent) {
      agentBundles++;
      continue;
    }
    const hasSkill = await fileExists(join(sub, "SKILL.md"));
    if (hasSkill) {
      skillBundles++;
      continue;
    }
    // No direct marker — recurse to find nested SKILL.md files (matches
    // discoverSkills' recursive walk convention, e.g. skills/<name>/SKILL.md).
    const nested = await countNestedSkills(sub);
    if (nested > 0) {
      skillBundles += nested;
      continue;
    }
    // Subdirectory has neither agent nor skill marker (even recursively).
    // Surface it as "empty" (likely leftover from an aborted `agent init`
    // or manual scaffolding) ONLY when:
    //   - it is literally empty, OR
    //   - it is a pre-Bug-B legacy refresh-manifest holder (a dir whose
    //     only content is `refresh-manifest.json`). The writer used to
    //     mkdir `<stateHome>/agents/<name>/` even when the bundle was
    //     the synthetic self-source; the path was moved to
    //     `<stateHome>/refresh/<name>/refresh-manifest.json`, but a user
    //     may still have leftover state. Skipping the legacy case here
    //     prevents the doctor from misreporting it as "leftover from
    //     aborted init" — defense in depth on top of the path move in
    //     `src/core/knowledge/refresh-manifest.ts`.
    if (await directoryIsEmpty(sub)) {
      emptyBundleDirs.push(entry.name);
    } else if (await directoryIsLegacyRefreshOnly(sub)) {
      // Intentionally do nothing — recognise and ignore.
    }
  }
  return {
    exists: true,
    agentBundles,
    skillBundles,
    emptyBundleDirs,
    isSingleAgentBundle,
    isSingleSkillBundle,
  };
}

async function directoryIsEmpty(p: string): Promise<boolean> {
  try {
    const entries = await readdir(p);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/**
 * Pre-Bug-B legacy probe: returns true when `p` contains exactly one
 * entry, `refresh-manifest.json`. Such dirs were created by the old
 * writer at `<stateHome>/agents/<name>/`. The path was moved to
 * `<stateHome>/refresh/<name>/`, so this only fires on legacy state.
 */
async function directoryIsLegacyRefreshOnly(p: string): Promise<boolean> {
  try {
    const entries = await readdir(p);
    return entries.length === 1 && entries[0] === "refresh-manifest.json";
  } catch {
    return false;
  }
}

/**
 * Recursively count SKILL.md files under `dir`, skipping `.git` and
 * `node_modules`. Mirrors the recursive walk in `discoverSkills` so the
 * doctor hygiene check matches the loader's discovery convention (e.g.
 * repos that nest skills under `skills/<name>/SKILL.md`).
 */
async function countNestedSkills(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const sub = join(dir, entry.name);
    if (await fileExists(join(sub, "SKILL.md"))) {
      count++;
    } else {
      count += await countNestedSkills(sub);
    }
  }
  return count;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

export type GitRunner = (args: string[], cwd?: string) => Promise<string>;

export type GitVerifyResult =
  | { ok: true }
  | { ok: false; reason: "not-a-git-repo" }
  | { ok: false; reason: "remote-mismatch"; found: Array<{ name: string; url: string }> };

/**
 * Verify that `path` is a git working tree AND that one of its remotes
 * matches `expected`. Match normalizes by stripping trailing `.git` and
 * trailing slash on both sides; case-sensitive otherwise.
 *
 * `runGit` is injected so callers (and tests) can swap the git binary
 * invocation. The default runner in `defaultRunGit` shells out to
 * `git -C <cwd> <args...>`.
 */
export async function verifyGitRemote(
  path: string,
  expected: string,
  runGit: GitRunner,
): Promise<GitVerifyResult> {
  try {
    await runGit(["rev-parse", "--show-toplevel"], path);
  } catch {
    return { ok: false, reason: "not-a-git-repo" };
  }

  const remoteOutput = await runGit(["remote", "-v"], path);
  const found = parseRemotes(remoteOutput);
  // Use the canonical normalizer so URL-shape variations (https:// vs
  // git@host:, trailing .git, case in host/owner/repo) match the same
  // way the duplicate-URL guards in install-from-url.ts treat them.
  const target = normalizeGitUrl(expected);
  if (found.some((r) => normalizeGitUrl(r.url) === target)) {
    return { ok: true };
  }
  return { ok: false, reason: "remote-mismatch", found };
}

function parseRemotes(output: string): Array<{ name: string; url: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; url: string }> = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "<name>\t<url> (fetch|push)"
    const match = /^([^\t]+)\t(\S+)\s+\((?:fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const name = match[1]!;
    const url = match[2]!;
    const key = `${name}\t${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url });
  }
  return out;
}

/** Default git runner: shells out via Bun.spawn. */
export const defaultRunGit: GitRunner = async (args, cwd) => {
  const proc =
    cwd === undefined
      ? Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" })
      : Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  }
  return stdout;
};
