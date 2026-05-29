// src/cli/commands/migrate-clones.ts
//
// One-shot migration helper for users coming from rc.1 whose external-
// repo clones live at the rc.1 location:
//
//   ~/.config/agent-smith/remote/<host>/<owner>/<repo>      (rc.1)
//
// rc.2 moved managed clones to the XDG-correct location:
//
//   ~/.local/state/agent-smith/remote/<host>/<owner>/<repo> (rc.2+)
//
// rc.2's release notes told users to manually `unregister --purge-clone`
// + `install --from <url>` to migrate. This helper does it for them:
// move the directory, update the registry entry's `rootPath`, save the
// registry. Both agent registry and skill registry are scanned.
//
// Safety ladder per entry (mirrors clone-purge-guard.ts conventions):
//   1. rootPath is under <stateHome>/remote (the rc.1 location)
//   2. URL recoverable: prefer remote.url (rc.2 provenance block),
//      fall back to legacy gitRemote field. Skip if neither.
//   3. .git directory exists at rootPath
//   4. origin URL matches recorded URL (modulo normalizeGitUrl)
//   5. Target path (computed via deriveRemotePath against the rc.2+
//      defaultRemoteRoot) does NOT already exist
//
// Failures at any step skip that entry with an explanatory `reason`;
// the rest of the migration continues. Cross-filesystem rename is
// handled by EXDEV-fallback to copy+verify+delete.

import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Source } from "../../core/types";
import { getOriginRemote } from "../../io/git";
import { sameGitRemote } from "../../io/git-url";
import { canonicalRegistryPath, loadRegistry, type Registry, saveRegistry } from "../../io/registry";
import { deriveRemotePath } from "../../io/remote-path";
import { defaultRemoteRoot } from "../../io/remote-root";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../../io/skill-registry";
import { stateHome } from "../../io/state-home";

/** Per-entry outcome of the migration sweep. Returned for CLI rendering. */
export type MigrateEntryResult =
  | { kind: "agent" | "skill"; label: string; oldPath: string; newPath: string; status: "migrated" }
  | { kind: "agent" | "skill"; label: string; oldPath: string; status: "skipped"; reason: string };

export interface MigrateClonesResult {
  /** Entries whose registry rootPath was already on the rc.2+ location — no work needed. */
  alreadyMigrated: number;
  /** Per-entry outcomes for entries that needed migration. */
  outcomes: MigrateEntryResult[];
  /** True iff at least one entry was actually moved + registry updated. */
  anyMigrated: boolean;
}

/**
 * Injectable surface — every IO call routes through deps so unit tests
 * can stub the filesystem and git invocations. Production callers omit
 * deps and the defaults take effect.
 */
export interface MigrateClonesDeps {
  /** Source rc.1 root. Defaults to `<stateHome()>/remote`. */
  oldRemoteRoot?: string;
  /** Target rc.2+ root. Defaults to `defaultRemoteRoot()`. */
  newRemoteRoot?: string;
  /** Agent registry path. Defaults to `canonicalRegistryPath()`. */
  registryPath?: string;
  /** Skill registry path. Defaults to `canonicalSkillRegistryPath()`. */
  skillRegistryPath?: string;
  /** Test seam for `getOriginRemote`. Defaults to the production helper. */
  readOrigin?: (cwd: string) => Promise<string | undefined>;
  /** When true, classify every entry but make no on-disk or registry changes. */
  dryRun?: boolean;
}

/**
 * Walk both registries, migrate every rc.1-located clone to the rc.2+
 * location, and update the registry entries' `rootPath` field to point
 * at the new location.
 */
export async function migrateClones(deps: MigrateClonesDeps = {}): Promise<MigrateClonesResult> {
  const oldRoot = deps.oldRemoteRoot ?? join(stateHome(), "remote");
  const newRoot = deps.newRemoteRoot ?? defaultRemoteRoot();
  const agentPath = deps.registryPath ?? canonicalRegistryPath();
  const skillPath = deps.skillRegistryPath ?? canonicalSkillRegistryPath();
  const readOrigin = deps.readOrigin ?? ((cwd: string) => getOriginRemote(cwd));
  const dryRun = deps.dryRun ?? false;

  const agentReg = await loadRegistry(agentPath);
  const skillReg = await loadSkillRegistry(skillPath);

  let alreadyMigrated = 0;
  const outcomes: MigrateEntryResult[] = [];

  // Process agent registry.
  for (const source of agentReg.sources) {
    const result = await classifyEntry(source, oldRoot, newRoot, readOrigin);
    if (result.status === "skip-not-rc1") {
      // Not under rc.1 root → either rc.2+ already, or some other path
      // entirely (project/user-global). Only count "already migrated"
      // if it's a clone under the new root.
      if (isInside(source.rootPath, newRoot)) alreadyMigrated++;
      continue;
    }
    if (result.status === "skipped") {
      outcomes.push({
        kind: "agent",
        label: source.label,
        oldPath: source.rootPath,
        status: "skipped",
        reason: result.reason,
      });
      continue;
    }
    // result.status === "ready"
    if (dryRun) {
      outcomes.push({
        kind: "agent",
        label: source.label,
        oldPath: source.rootPath,
        newPath: result.targetDir,
        status: "migrated", // dry-run reports as if it would migrate
      });
      continue;
    }
    try {
      await moveClone(source.rootPath, result.targetDir);
      source.rootPath = result.targetDir;
      outcomes.push({
        kind: "agent",
        label: source.label,
        oldPath: result.oldPathBeforeMove,
        newPath: result.targetDir,
        status: "migrated",
      });
    } catch (err) {
      outcomes.push({
        kind: "agent",
        label: source.label,
        oldPath: source.rootPath,
        status: "skipped",
        reason: `move failed: ${(err as Error).message}`,
      });
    }
  }

  // Process skill registry.
  for (const catalog of skillReg.catalogs) {
    const result = await classifyEntry(catalog, oldRoot, newRoot, readOrigin);
    if (result.status === "skip-not-rc1") {
      if (isInside(catalog.rootPath, newRoot)) alreadyMigrated++;
      continue;
    }
    if (result.status === "skipped") {
      outcomes.push({
        kind: "skill",
        label: catalog.label,
        oldPath: catalog.rootPath,
        status: "skipped",
        reason: result.reason,
      });
      continue;
    }
    if (dryRun) {
      outcomes.push({
        kind: "skill",
        label: catalog.label,
        oldPath: catalog.rootPath,
        newPath: result.targetDir,
        status: "migrated",
      });
      continue;
    }
    try {
      await moveClone(catalog.rootPath, result.targetDir);
      catalog.rootPath = result.targetDir;
      outcomes.push({
        kind: "skill",
        label: catalog.label,
        oldPath: result.oldPathBeforeMove,
        newPath: result.targetDir,
        status: "migrated",
      });
    } catch (err) {
      outcomes.push({
        kind: "skill",
        label: catalog.label,
        oldPath: catalog.rootPath,
        status: "skipped",
        reason: `move failed: ${(err as Error).message}`,
      });
    }
  }

  // Persist registries — only if at least one entry moved AND not dry-run.
  const anyMigrated = outcomes.some((o) => o.status === "migrated");
  if (!dryRun && anyMigrated) {
    await saveRegistry(agentPath, agentReg);
    await saveSkillRegistry(skillPath, skillReg);
  }

  return { alreadyMigrated, outcomes, anyMigrated };
}

/**
 * Per-entry classifier result.
 *   - `skip-not-rc1`: rootPath is not under the rc.1 location → no
 *     migration applies. The caller decides whether this counts as
 *     "already-migrated" (if under new root) or "out-of-scope".
 *   - `skipped`: rc.1 located but a guard tripped — see `reason`.
 *   - `ready`: passed all guards. `targetDir` is the rc.2+ destination.
 */
type EntryClassification =
  | { status: "skip-not-rc1" }
  | { status: "skipped"; reason: string }
  | { status: "ready"; targetDir: string; oldPathBeforeMove: string };

interface RegistryEntry {
  rootPath: string;
  remote?: { url: string } | undefined;
  gitRemote?: string | undefined;
}

async function classifyEntry(
  entry: RegistryEntry,
  oldRoot: string,
  newRoot: string,
  readOrigin: (cwd: string) => Promise<string | undefined>,
): Promise<EntryClassification> {
  if (!isInside(entry.rootPath, oldRoot)) {
    return { status: "skip-not-rc1" };
  }

  // URL: prefer the rc.2 provenance block; fall back to the legacy
  // gitRemote field for catalogs registered before rc.2.
  const url = entry.remote?.url ?? entry.gitRemote;
  if (!url) {
    return {
      status: "skipped",
      reason: "no recorded URL (neither remote.url nor gitRemote) — cannot verify migration target",
    };
  }

  // .git directory must exist.
  const gitDir = join(entry.rootPath, ".git");
  let gitExists = false;
  try {
    const st = await stat(gitDir);
    gitExists = st.isDirectory() || st.isFile();
  } catch {
    gitExists = false;
  }
  if (!gitExists) {
    return {
      status: "skipped",
      reason: `.git not found at ${entry.rootPath}`,
    };
  }

  // Origin URL must match recorded URL.
  const actualOrigin = await readOrigin(entry.rootPath);
  if (!actualOrigin) {
    return {
      status: "skipped",
      reason: "could not read 'origin' URL from clone",
    };
  }
  if (!sameGitRemote(actualOrigin, url)) {
    return {
      status: "skipped",
      reason: `origin URL (${actualOrigin}) does not match recorded URL (${url})`,
    };
  }

  // Compute target path under the new remote root.
  let targetDir: string;
  try {
    targetDir = deriveRemotePath(url, newRoot);
  } catch (err) {
    return {
      status: "skipped",
      reason: `cannot derive target path: ${(err as Error).message}`,
    };
  }

  // Refuse if target already exists — that would imply the user already
  // has a rc.2+ clone for the same URL (likely from a manual re-install).
  // Don't risk overwriting it; tell the user to resolve manually.
  let targetExists = false;
  try {
    await stat(targetDir);
    targetExists = true;
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    return {
      status: "skipped",
      reason: `target ${targetDir} already exists — resolve manually with 'smith agent unregister' or 'smith skill unregister'`,
    };
  }

  return { status: "ready", targetDir, oldPathBeforeMove: entry.rootPath };
}

/**
 * Atomically move `src` → `dst`. On EXDEV (different filesystems) falls
 * back to copy-tree + verify + remove-source. The fallback is best-
 * effort: if the verify step fails, the source is left intact so the
 * user can retry or recover manually.
 */
async function moveClone(src: string, dst: string): Promise<void> {
  await mkdir(dirname(dst), { recursive: true });
  try {
    await rename(src, dst);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") {
      throw err;
    }
  }
  // EXDEV fallback: cross-filesystem move via copy + verify + delete.
  await copyTree(src, dst);
  // Sanity: target now exists.
  await stat(dst);
  await rm(src, { recursive: true, force: true });
}

async function copyTree(src: string, dst: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(s, d);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks verbatim — common inside .git for packed-refs etc.
      const { readlink, symlink } = await import("node:fs/promises");
      const target = await readlink(s);
      await symlink(target, d);
    } else {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(s, d);
    }
  }
}

function isInside(target: string, root: string): boolean {
  const normalized = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(normalized);
}

/**
 * Detection-only counterpart used by `smith doctor` to flag rc.1 clones
 * without performing the migration. Returns the count and a sample of
 * up-to-3 affected catalog labels for the doctor report. Pure read —
 * no registry mutations, no filesystem moves.
 */
export async function detectRc1Clones(
  deps: MigrateClonesDeps = {},
): Promise<{ count: number; sample: string[] }> {
  const oldRoot = deps.oldRemoteRoot ?? join(stateHome(), "remote");
  const agentPath = deps.registryPath ?? canonicalRegistryPath();
  const skillPath = deps.skillRegistryPath ?? canonicalSkillRegistryPath();

  const [agentReg, skillReg] = await Promise.all([
    loadRegistry(agentPath),
    loadSkillRegistry(skillPath),
  ]);

  const sample: string[] = [];
  let count = 0;
  for (const s of agentReg.sources) {
    if (isInside(s.rootPath, oldRoot)) {
      count++;
      if (sample.length < 3) sample.push(`agent:${s.label}`);
    }
  }
  for (const c of skillReg.catalogs) {
    if (isInside(c.rootPath, oldRoot)) {
      count++;
      if (sample.length < 3) sample.push(`skill:${c.label}`);
    }
  }
  return { count, sample };
}

// Re-export Registry and Source for the test file's convenience.
export type { Registry, Source };
