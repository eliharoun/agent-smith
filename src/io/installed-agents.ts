/**
 * Manifest of agents smith has installed. Mirrors src/io/installed-skills.ts
 * for agents (single-file, single-hash) instead of skills (whole-directory).
 *
 * The manifest is the source of truth for "did smith install this file?" —
 * it does NOT read other tools' sentinels or content. Pre-existing files
 * are claimed lazily on hash-match (smith's own render byte-equals the
 * on-disk file) or refused with a `would-clobber` SmithError otherwise.
 *
 * Concurrency: callers wrap the read-modify-write cycle in
 * `withFileLock(manifestPath, ...)` (from src/io/git-lock.ts). The lock
 * is held for milliseconds — only the JSON mutation, not any IO on the
 * agent file itself.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write";
import { stateHome } from "./state-home";

const FILE_REL = ".config/agent-smith/installed-agents.json";
const FILE_BASENAME = "installed-agents.json";

export interface InstalledAgent {
  /** Agent bundle name (matches CanonicalConfig.name). */
  name: string;
  /** Target platform identifier (matches Target). */
  platform: string;
  /** Absolute path on disk where smith wrote the rendered agent file. */
  path: string;
  /**
   * sha256 of the serialized rendered output as smith last wrote it.
   * Used for two checks:
   *  - On install: re-render and hash; if equal to disk hash AND equal to
   *    this entry, install is idempotent (no write needed).
   *  - On uninstall: hash the current disk file; if it differs from this
   *    value the file was modified externally — refuse without --force.
   * Format: "sha256:<hex>".
   */
  contentHash: string;
  /** ISO 8601 timestamp of the most recent (re)install. */
  installedAt: string;
  /**
   * Distinguishes the agent's main rendered file ("main") from any
   * sibling files emitted alongside it ("sidecar"). Defaults to "main"
   * when absent (backward-compat for manifests written before sidecars
   * existed). Currently only Codex emits sidecars
   * (`<name>/agents/openai.yaml` next to `<name>/SKILL.md`); other
   * translators may add them later. The installer/uninstaller use this
   * field to disambiguate which entry tracks the canonical main file
   * for a (name, platform) pair (path-mismatch detection,
   * external-modification refusal) versus auxiliary sidecar files
   * (independently tracked + removed).
   */
  kind?: "main" | "sidecar";
}

export interface InstalledAgentsFile {
  /** Currently `1`. Bump on incompatible schema changes. */
  schemaVersion: 1;
  installed: InstalledAgent[];
}

export interface InstalledAgentsOpts {
  /**
   * Override the home directory used for path resolution. Tests inject
   * a tmpdir; production omits and gets `stateHome()` (honors
   * XDG_CONFIG_HOME). Mirrors the `homeDir` test seam in
   * src/io/installed-skills.ts.
   */
  homeDir?: string;
}

// When `homeDir` is supplied (test seam), preserve HOME-suffix semantics so
// existing tests can write under a tmpdir without setting XDG. Production
// callers (no opts) route through `stateHome()` so $XDG_CONFIG_HOME is honored.
function pathFor(opts?: InstalledAgentsOpts): string {
  if (opts?.homeDir) return join(opts.homeDir, FILE_REL);
  return join(stateHome(), FILE_BASENAME);
}

export async function loadInstalledAgents(
  opts?: InstalledAgentsOpts,
): Promise<InstalledAgentsFile> {
  let raw: string;
  try {
    raw = await readFile(pathFor(opts), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, installed: [] };
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as InstalledAgentsFile;
  // Lenient on shape: if the file is malformed, return a fresh empty
  // manifest rather than crashing. Same posture as installed-skills.ts on
  // ENOENT, but for shape we degrade gracefully here so a corrupted
  // manifest doesn't block installs/uninstalls — the next write replaces it.
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.installed)) {
    return { schemaVersion: 1, installed: [] };
  }
  return parsed;
}

export async function saveInstalledAgents(
  file: InstalledAgentsFile,
  opts?: InstalledAgentsOpts,
): Promise<void> {
  await atomicWriteJson(pathFor(opts), file);
}

/**
 * Add or replace an entry by (name, platform, path). Pure — returns a new file.
 *
 * Keying by all three fields (rather than the original (name, platform))
 * lets a single render write multiple files at distinct paths — e.g.
 * Codex's main `<name>/SKILL.md` plus its `<name>/agents/openai.yaml`
 * sidecar — without one entry replacing the other. Existing call sites
 * that re-add the same exact path replace in place exactly as before.
 */
export function addInstalledAgent(
  file: InstalledAgentsFile,
  entry: InstalledAgent,
): InstalledAgentsFile {
  const filtered = file.installed.filter(
    (e) => !(e.name === entry.name && e.platform === entry.platform && e.path === entry.path),
  );
  return { schemaVersion: 1, installed: [...filtered, entry] };
}

/**
 * Remove every entry matching the predicate. Pure.
 */
export function removeInstalledAgent(
  file: InstalledAgentsFile,
  predicate: (entry: InstalledAgent) => boolean,
): InstalledAgentsFile {
  return { schemaVersion: 1, installed: file.installed.filter((e) => !predicate(e)) };
}

/**
 * sha256 hex of a serialized string, prefixed `sha256:` for forward-compat
 * with future hash algorithms.
 */
export function hashContent(serialized: string): string {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}
