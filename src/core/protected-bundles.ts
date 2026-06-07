import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTECTED_AGENTS = ["agent-smith"] as const;
export const PROTECTED_CATALOGS = ["agent-smith-self"] as const;
export const PROTECTED_SKILLS = ["the-architect", "the-keymaker"] as const;

// Mirror of WORKSPACE_PKG_NAMES in src/io/workspace-version.ts. Kept local and
// sync so clone detection needs no async resolveWorkspacePath. If that set
// changes, change it here too — there is a parity test in
// tests/core/protected-bundles.test.ts that fails if the canonical source
// stops listing both names.
const WORKSPACE_PKG_NAMES = new Set(["agent-smith", "@eliharoun/agent-smith"]);

export type ProtectedKind = "agent" | "skill" | "catalog";
export type ProtectedVerb =
  | "uninstall"
  | "destroy"
  | "reconfigure"
  | "edit"
  | "unregister"
  | "knowledge.add"
  | "knowledge.remove"
  | "knowledge.edit";

export function isProtectedAgent(name: string): boolean {
  return PROTECTED_AGENTS.includes(name as (typeof PROTECTED_AGENTS)[number]);
}
export function isProtectedCatalog(label: string): boolean {
  return PROTECTED_CATALOGS.includes(label as (typeof PROTECTED_CATALOGS)[number]);
}
export function isProtectedSkill(name: string): boolean {
  return PROTECTED_SKILLS.includes(name as (typeof PROTECTED_SKILLS)[number]);
}

interface RefusalArgs {
  entity: string;
  kind: ProtectedKind;
  verb: ProtectedVerb;
}

/**
 * Format a human-readable refusal pointing at the legitimate alternative.
 * Used as the headline for `protected-bundle` SmithErrors.
 */
export function refusalMessage(args: RefusalArgs): string {
  const { entity, kind, verb } = args;
  return (
    `Cannot ${verb.replace(".", " ")} ${kind} "${entity}": this is a system ${kind} ` +
    `managed by smith. To refresh it, run \`smith update\`. To remove smith entirely, ` +
    `use your package manager to uninstall agent-smith.`
  );
}

/**
 * Sync predicate: is `repoRoot` a maintainer clone of the smith repo?
 * True iff it has BOTH a package.json whose name is in WORKSPACE_PKG_NAMES
 * AND a `.git` entry. The `.git` entry is a directory in a normal clone and a
 * regular file (a `gitdir:` pointer) in a git worktree or submodule — both
 * count as a maintainer checkout. npm-published tarballs strip `.git`
 * entirely, so its mere presence is the reliable clone signal (false-positive
 * rate ≈ zero). Exported for unit tests (they stage a tmpdir).
 */
export function _checkLocalSmithClone(repoRoot: string | null): boolean {
  if (!repoRoot) return false;
  try {
    const pkgPath = join(repoRoot, "package.json");
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (!pkg.name || !WORKSPACE_PKG_NAMES.has(pkg.name)) return false;
    const gitPath = join(repoRoot, ".git");
    if (!existsSync(gitPath)) return false;
    const st = statSync(gitPath);
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

/**
 * Sync walk-up from a source file looking for the first ancestor dir whose
 * package.json name is in WORKSPACE_PKG_NAMES. Returns that dir or null.
 * This is the sync analogue of the async resolveWorkspacePath; we keep it
 * sync so isLocalSmithClone() can be a plain cached boolean getter.
 */
function _resolveCloneRoot(startFile: string): string | null {
  let dir = dirname(startFile);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name && WORKSPACE_PKG_NAMES.has(pkg.name)) return dir;
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

let _cloneModeOverride: boolean | null = null;
/** Test-only override; production never calls this. */
export function _setCloneModeForTesting(value: boolean | null): void {
  _cloneModeOverride = value;
  _cached = null; // force re-evaluation after the override is cleared
}

let _cached: boolean | null = null;
/**
 * True when the running smith binary is a maintainer's clone of the smith repo
 * (not an npm-installed package). End-users get false. Cached for the process
 * lifetime — import.meta.url doesn't change at runtime.
 */
export function isLocalSmithClone(): boolean {
  if (_cloneModeOverride !== null) return _cloneModeOverride;
  if (_cached !== null) return _cached;
  const here = fileURLToPath(import.meta.url);
  _cached = _checkLocalSmithClone(_resolveCloneRoot(here));
  return _cached;
}

/** Resolve the clone repo root for display in prompts. null when not a clone. */
export function cloneRepoRoot(): string | null {
  const here = fileURLToPath(import.meta.url);
  return _resolveCloneRoot(here);
}
