// Install/update/uninstall verbs for skills. Each verb copies (not symlinks)
// a whole skill directory into the three platform skill dirs and records
// state in installed-skills.json with a content hash so doctor can detect
// drift. Symlinks would defeat drift detection (see spec §7.4).

import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertWithin } from "./assert-within";
import {
  addInstalledSkill,
  hashSkillDir,
  type InstalledSkill,
  loadInstalledSkills,
  removeInstalledSkill,
  saveInstalledSkills,
} from "./installed-skills";
import { findSkillByName as defaultFindSkill, type FindSkillResult } from "./skill-discovery";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  removeCatalog,
  type SkillRegistry,
  saveSkillRegistry,
} from "./skill-registry";

/**
 * Strict kebab-case skill-name regex. Used as a path-traversal guard before
 * any filesystem op uses `name` as a path segment. Mirrors the spirit of
 * skill-discovery's SKILL_NAME_RE but is duplicated here to keep this module
 * authoritative for its own input validation (defense in depth — caller
 * trust does not absolve us).
 */
const SAFE_SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

/**
 * Reject names that could escape the platform skill dir or evade the
 * registry-discovery filter. Surfaces one error message rather than three
 * different ones because the user only needs to know the name is bad.
 */
function validateSkillName(name: string): { ok: true } | { ok: false; error: string } {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 64 ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.startsWith(".") ||
    !SAFE_SKILL_NAME_RE.test(name)
  ) {
    return {
      ok: false,
      error: `Invalid skill name '${name}': must be kebab-case, max 64 chars, no slashes, no '..', no leading dot.`,
    };
  }
  return { ok: true };
}

/** Public re-export for CLI input validation; same rule as the internal guard. */
export function isSafeSkillName(name: string): boolean {
  return validateSkillName(name).ok;
}

function registryPathFor(homeDir?: string): string {
  return homeDir
    ? join(homeDir, ".config/agent-smith/skill-catalogs.json")
    : canonicalSkillRegistryPath();
}

export type PlatformId = "opencode" | "claude-code" | "codex" | "kiro";
type PlatformKey = "opencode" | "claudeCode" | "codex" | "kiro";

const PLATFORM_KEY: Record<PlatformId, PlatformKey> = {
  opencode: "opencode",
  "claude-code": "claudeCode",
  codex: "codex",
  kiro: "kiro",
};

export interface PlatformDirs {
  opencode?: string;
  claudeCode?: string;
  codex?: string;
  kiro?: string;
}

/** Default per-platform skill dirs. */
export function defaultPlatformSkillDirs(home?: string): Required<PlatformDirs> {
  const h = home ?? homedir();
  return {
    opencode: join(h, ".config/opencode/skills"),
    claudeCode: join(h, ".claude/skills"),
    codex: join(h, ".agents/skills"),
    kiro: join(h, ".kiro/skills"),
  };
}

export interface InstallSkillOpts {
  /** Override platform dirs entirely. Otherwise defaults from $HOME. */
  platformDirs?: PlatformDirs;
  /** When provided, restrict install to a subset of platforms. */
  targets?: ReadonlyArray<PlatformId>;
  /** Test seam for state-file home dir. Also drives default platformDirs. */
  homeDir?: string;
  /** Test seam for the now() clock. */
  now?: () => Date;
  /**
   * Direct path to a skill dir, bypassing registry lookup. Used by bootstrap
   * (bundled architect) and by ad-hoc `--from <path>` once the orchestrating
   * CLI has auto-created the catalog.
   */
  sourceOverride?: { sourceDir: string; sourceCatalogLabel: string };
  /** When set, restrict catalog lookup to this catalog label. */
  catalog?: string;
  /** Test seam: override the registry lookup. */
  findSkill?: (
    registry: SkillRegistry,
    name: string,
    opts?: { catalog?: string },
  ) => Promise<FindSkillResult>;
}

export type InstallSkillResult =
  | { ok: true; installed: InstalledSkill }
  | { ok: false; error: string };

export async function installSkill(
  name: string,
  opts: InstallSkillOpts = {},
): Promise<InstallSkillResult> {
  const guard = validateSkillName(name);
  if (!guard.ok) return { ok: false, error: guard.error };

  const dirs = {
    ...defaultPlatformSkillDirs(opts.homeDir),
    ...(opts.platformDirs ?? {}),
  };
  const now = (opts.now ?? (() => new Date()))();

  const file = await loadInstalledSkills(opts.homeDir ? { homeDir: opts.homeDir } : undefined);
  if (file.installed.some((e) => e.name === name)) {
    return {
      ok: false,
      error: `Skill '${name}' is already installed. Run 'smith skill update ${name}' to refresh from source.`,
    };
  }

  let sourceDir: string;
  let sourceCatalogLabel: string;
  if (opts.sourceOverride) {
    ({ sourceDir, sourceCatalogLabel } = opts.sourceOverride);
  } else {
    const registry = await loadSkillRegistry(registryPathFor(opts.homeDir));
    const find = opts.findSkill ?? defaultFindSkill;
    const lookup = await find(registry, name, opts.catalog ? { catalog: opts.catalog } : undefined);
    if ("error" in lookup) {
      if (lookup.error === "not-found") {
        return {
          ok: false,
          error: `Skill '${name}' not found in any registered catalog.`,
        };
      }
      const list = lookup.matches.map((m) => `${m.catalogLabel}/${m.name}`).join(", ");
      return {
        ok: false,
        error: `Skill name '${name}' is ambiguous (matches: ${list}). Disambiguate with 'smith skill install <catalog>/${name}'.`,
      };
    }
    sourceDir = lookup.path;
    sourceCatalogLabel = lookup.catalogLabel;
  }

  const installedPaths = await copyToPlatforms(name, sourceDir, dirs, opts.targets).catch(
    (err: Error) => err,
  );
  if (installedPaths instanceof Error) {
    return { ok: false, error: `install failed: ${installedPaths.message}` };
  }
  const firstDest = pickFirstInstalledPath(installedPaths);
  if (!firstDest) {
    return { ok: false, error: `install failed: no platforms written` };
  }
  const contentHash = await hashSkillDir(firstDest);
  const entry: InstalledSkill = {
    name,
    sourceCatalogLabel,
    sourcePath: sourceDir,
    installedPaths,
    contentHash,
    installedAt: now.toISOString(),
  };
  await saveInstalledSkills(
    addInstalledSkill(file, entry),
    opts.homeDir ? { homeDir: opts.homeDir } : undefined,
  );

  return { ok: true, installed: entry };
}

export async function updateSkill(
  name: string,
  opts: InstallSkillOpts = {},
): Promise<InstallSkillResult> {
  const guard = validateSkillName(name);
  if (!guard.ok) return { ok: false, error: guard.error };

  const dirs = {
    ...defaultPlatformSkillDirs(opts.homeDir),
    ...(opts.platformDirs ?? {}),
  };
  const now = (opts.now ?? (() => new Date()))();
  const file = await loadInstalledSkills(opts.homeDir ? { homeDir: opts.homeDir } : undefined);
  const existing = file.installed.find((e) => e.name === name);
  if (!existing) {
    return { ok: false, error: `Skill '${name}' is not installed.` };
  }
  if (!(await pathExists(existing.sourcePath))) {
    return {
      ok: false,
      error: `Source for '${name}' no longer exists at ${existing.sourcePath}. Re-register the catalog or reinstall from a new source.`,
    };
  }

  const installedPaths = await copyToPlatforms(name, existing.sourcePath, dirs, opts.targets).catch(
    (err: Error) => err,
  );
  if (installedPaths instanceof Error) {
    return { ok: false, error: `update failed: ${installedPaths.message}` };
  }
  const firstDest = pickFirstInstalledPath(installedPaths);
  if (!firstDest) {
    return { ok: false, error: `update failed: no platforms written` };
  }
  const updated: InstalledSkill = {
    ...existing,
    installedPaths,
    contentHash: await hashSkillDir(firstDest),
    installedAt: now.toISOString(),
  };
  await saveInstalledSkills(
    addInstalledSkill(file, updated),
    opts.homeDir ? { homeDir: opts.homeDir } : undefined,
  );
  return { ok: true, installed: updated };
}

export async function uninstallSkill(
  name: string,
  opts: InstallSkillOpts = {},
): Promise<InstallSkillResult> {
  const guard = validateSkillName(name);
  if (!guard.ok) return { ok: false, error: guard.error };

  const file = await loadInstalledSkills(opts.homeDir ? { homeDir: opts.homeDir } : undefined);
  const existing = file.installed.find((e) => e.name === name);
  if (!existing) {
    return { ok: false, error: `Skill '${name}' is not installed.` };
  }

  // Defense-in-depth [v1-task B6]: installed-skills.json is user-editable
  // state; an attacker who could write to it could plant a `dest` outside
  // the platform skill dirs and turn uninstall into arbitrary rm -rf.
  // Re-resolve the canonical platform dirs and assert each dest still sits
  // within one of them before any rm. Skip platforms whose dir no longer
  // exists — rm on a missing dest is a harmless no-op.
  const dirs = {
    ...defaultPlatformSkillDirs(opts.homeDir),
    ...(opts.platformDirs ?? {}),
  };
  for (const [platformKey, dest] of Object.entries(existing.installedPaths) as Array<
    [PlatformKey, string | undefined]
  >) {
    if (!dest) continue;
    const baseDir = dirs[platformKey];
    if (!baseDir) continue;
    if (!(await pathExists(baseDir))) continue;
    await assertWithin(dest, baseDir);
  }

  for (const dest of Object.values(existing.installedPaths)) {
    if (!dest) continue;
    await rm(dest, { recursive: true, force: true });
  }
  await saveInstalledSkills(
    removeInstalledSkill(file, name),
    opts.homeDir ? { homeDir: opts.homeDir } : undefined,
  );

  // Auto-unregister adhoc catalogs whose last installed skill just left.
  const registryPath = registryPathFor(opts.homeDir);
  const registry = await loadSkillRegistry(registryPath);
  const cat = registry.catalogs.find((c) => c.label === existing.sourceCatalogLabel);
  if (cat?.adhoc) {
    const remaining = file.installed.filter(
      (e) => e.name !== name && e.sourceCatalogLabel === cat.label,
    );
    if (remaining.length === 0) {
      const updated = removeCatalog(registry, cat.label);
      await saveSkillRegistry(registryPath, updated);
    }
  }
  return { ok: true, installed: existing };
}

async function copyToPlatforms(
  name: string,
  sourceDir: string,
  dirs: Required<PlatformDirs>,
  targets: ReadonlyArray<PlatformId> | undefined,
): Promise<InstalledSkill["installedPaths"]> {
  const allPlatforms: PlatformId[] = ["opencode", "claude-code", "codex", "kiro"];
  const requested = targets ? new Set<PlatformId>(targets) : new Set(allPlatforms);
  // When the caller passes an explicit target set, honor it: create the
  // platform skill dir if missing. Only the implicit "install everywhere"
  // case skips platforms whose dir doesn't already exist.
  const explicit = targets !== undefined;
  const installedPaths: InstalledSkill["installedPaths"] = {};
  // Track every dest we've written to so we can roll back on later failure.
  // This makes installSkill atomic-from-the-user's-perspective: either every
  // requested platform gets the new skill, or none do (no half-installs).
  const written: string[] = [];
  try {
    for (const platform of allPlatforms) {
      if (!requested.has(platform)) continue;
      const baseDir = dirs[PLATFORM_KEY[platform]];
      if (!baseDir) continue;
      if (!explicit && !(await pathExists(baseDir))) continue; // implicit: skip absent
      const dest = join(baseDir, name);
      // Defense-in-depth [v1-task B6]: `name` is validated by
      // validateSkillName at the entry point, but copyToPlatforms is also
      // reachable via sourceOverride paths. Belt-and-suspenders before
      // any rm/cp.
      await mkdir(baseDir, { recursive: true });
      await assertWithin(dest, baseDir);
      if (await pathExists(dest)) {
        await rm(dest, { recursive: true, force: true });
      }
      // verbatimSymlinks + dereference:false: symlinks in the source are
      // copied AS symlinks (not followed). Prevents a hostile catalog from
      // shipping `secret -> /etc/passwd` and getting that file deep-copied
      // into the user's platform skill dirs. Bun ≥1.x supports both flags.
      await cp(sourceDir, dest, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
      });
      written.push(dest);
      installedPaths[PLATFORM_KEY[platform]] = dest;
    }
    return installedPaths;
  } catch (err) {
    // Best-effort rollback: each rm() swallows its own error so a partial
    // failure during cleanup doesn't mask the original cp() failure.
    for (const d of written) {
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the first installed destination, in opencode → claude-code → codex
 * order. Matches the canonical platform order defined in `copyToPlatforms`
 * (the `allPlatforms` array above), which is itself the same order doctor's
 * drift detection rehashes. Returns `undefined` when `installedPaths` is
 * empty (no platforms were written — e.g., --targets filtered to only
 * platforms whose dirs don't exist).
 */
function pickFirstInstalledPath(paths: InstalledSkill["installedPaths"]): string | undefined {
  return paths.opencode ?? paths.claudeCode ?? paths.codex ?? paths.kiro;
}
