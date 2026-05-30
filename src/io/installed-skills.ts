// State file at ~/.config/agent-smith/installed-skills.json that records
// every skill installed by `smith skill install` (and `smith bootstrap`'s
// the-architect). Pure data + I/O; the install/update/uninstall verbs that
// mutate platform skill dirs live in src/io/skill-installer.ts.

import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import { atomicWriteJson } from "./atomic-write";
import { stateHome } from "./state-home";

export interface InstalledSkill {
  name: string;
  /** Catalog label (D1 SkillCatalog.label) the skill was sourced from. */
  sourceCatalogLabel: string;
  /** Absolute path to the on-disk skill dir at install time. */
  sourcePath: string;
  /** Absolute paths actually written; key omitted if the platform was skipped. */
  installedPaths: {
    opencode?: string;
    claudeCode?: string;
    codex?: string;
    kiro?: string;
  };
  /** sha256 hex over recursive sorted dirent contents (see hashSkillDir). */
  contentHash: string;
  /** ISO 8601. */
  installedAt: string;
}

export interface InstalledSkillsFile {
  schemaVersion: 1;
  installed: InstalledSkill[];
}

const FILE_REL = ".config/agent-smith/installed-skills.json";
const FILE_BASENAME = "installed-skills.json";

// When `homeDir` is supplied (test seam), preserve HOME-suffix semantics so
// existing tests can write under a tmpdir without setting XDG. Production
// callers (no opts) route through `stateHome()` so $XDG_CONFIG_HOME is honored.
function pathFor(opts?: { homeDir?: string }): string {
  if (opts?.homeDir) return join(opts.homeDir, FILE_REL);
  return join(stateHome(), FILE_BASENAME);
}

export async function loadInstalledSkills(
  opts?: { homeDir?: string },
): Promise<InstalledSkillsFile> {
  const p = pathFor(opts);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, installed: [] };
    }
    throw err; // EACCES etc. — bubble as unknown
  }
  let parsed: { schemaVersion?: unknown; version?: unknown; installed?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (err) {
    throw new SmithError(
      {
        code: "installed-skills-corrupt",
        path: p,
        parseError: toMessage(err),
      },
      { cause: err },
    );
  }
  // B11.3 migration: accept either `schemaVersion` (new) or `version`
  // (legacy) on read. Writer emits `schemaVersion` only.
  const rawVersion =
    "schemaVersion" in parsed ? parsed.schemaVersion : parsed.version;
  if (rawVersion !== 1 || !Array.isArray(parsed.installed)) {
    throw new SmithError({
      code: "installed-skills-corrupt",
      path: p,
      parseError: "malformed shape (expected {schemaVersion:1, installed:[]})",
    });
  }
  return { schemaVersion: 1, installed: parsed.installed as InstalledSkill[] };
}

export async function saveInstalledSkills(
  file: InstalledSkillsFile,
  opts?: { homeDir?: string },
): Promise<void> {
  await atomicWriteJson(pathFor(opts), file);
}

export function addInstalledSkill(
  file: InstalledSkillsFile,
  entry: InstalledSkill,
): InstalledSkillsFile {
  const next = file.installed.filter((e) => e.name !== entry.name);
  next.push(entry);
  return { schemaVersion: 1, installed: next };
}

export function removeInstalledSkill(
  file: InstalledSkillsFile,
  name: string,
): InstalledSkillsFile {
  return {
    schemaVersion: 1,
    installed: file.installed.filter((e) => e.name !== name),
  };
}

/**
 * Recursive sha256 of a skill directory. Hashes the sorted list of
 * `<posix-relative-path>:<sha256(file-bytes)>` lines so the result is stable
 * across filesystems and machines.
 *
 * Hardening:
 *   - Symlinks are NEVER followed. Each symlink is recorded as
 *     `<rel>:SYMLINK\n` so its presence/absence still affects the hash, but
 *     a hostile symlink to /etc/passwd cannot be slurped into the hash and
 *     a symlink loop cannot hang the walk.
 *   - Regular files larger than {@link MAX_HASHED_FILE_BYTES} are recorded as
 *     `<rel>:SKIPPED-LARGE\n` rather than read into memory. Skill assets
 *     this big are out of scope for drift detection.
 *
 * Required by spec Q4 (whole-dir hashing — catches edits to scripts/,
 * references/, assets/, not just SKILL.md).
 */
const MAX_HASHED_FILE_BYTES = 10 * 1024 * 1024;

export async function hashSkillDir(absDir: string): Promise<string> {
  const entries: { rel: string; hash: string }[] = [];
  await walk(absDir, absDir, entries);
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const top = createHash("sha256");
  for (const e of entries) {
    top.update(`${e.rel}:${e.hash}\n`);
  }
  return top.digest("hex");
}

async function walk(
  base: string,
  current: string,
  out: { rel: string; hash: string }[],
): Promise<void> {
  const dirents = await readdir(current, { withFileTypes: true });
  for (const d of dirents) {
    const abs = join(current, d.name);
    const rel = relative(base, abs).split(sep).join("/");
    // Use Dirent type info (filled by readdir withFileTypes), which mirrors
    // lstat semantics — symlinks are reported as symlinks, NOT followed.
    if (d.isSymbolicLink()) {
      out.push({ rel, hash: "SYMLINK" });
      continue;
    }
    if (d.isDirectory()) {
      await walk(base, abs, out);
      continue;
    }
    if (!d.isFile()) continue;
    // lstat (not stat) so any race-condition replacement with a symlink
    // mid-walk is still caught.
    let size: number;
    try {
      const s = await lstat(abs);
      if (!s.isFile()) continue;
      size = s.size;
    } catch {
      continue;
    }
    if (size > MAX_HASHED_FILE_BYTES) {
      out.push({ rel, hash: "SKIPPED-LARGE" });
      continue;
    }
    const buf = await readFile(abs);
    const h = createHash("sha256").update(buf).digest("hex");
    out.push({ rel, hash: h });
  }
}
