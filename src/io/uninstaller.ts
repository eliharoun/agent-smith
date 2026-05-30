import { readFile, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultCodexHome, defaultOpencodeConfigHome } from "../cli/install-paths";
import {
  readRefreshManifest,
  removeRefreshManifest,
  writeRefreshManifest,
} from "../core/knowledge/refresh-manifest";
import type { AgentBundle, InstallPaths, Target } from "../core/types";
import { assertWithin } from "./assert-within";
import { removeAgentFromCodexHooks } from "./codex-hooks";
import { withFileLock } from "./git-lock";
import {
  hashContent,
  loadInstalledAgents,
  removeInstalledAgent,
  saveInstalledAgents,
} from "./installed-agents";
import type { KnowledgePaths } from "./knowledge-paths";
import { knowledgeDirFor } from "./knowledge-paths";
import { unregisterAgentFromOpencodePlugin } from "./opencode-plugin";
import type { PlatformId } from "./platform-detect";
import { stateHome } from "./state-home";

export interface UninstallResult {
  removed: string[];
  notFound: string[];
  errors: { path: string; message: string }[];
  /**
   * Per-target refusals to delete because the on-disk file's hash differs
   * from the manifest's recorded `contentHash` (the file was modified after
   * smith installed it). Surfaced as data, not thrown — `removeAllBundles`
   * aggregates across bundles. The CLI command layer translates a
   * non-empty `refused[]` into a SmithError("already-exists") with the
   * `suggestedCommand` field.
   *
   * `--force` (passed via `UninstallerDeps.force`) bypasses the check;
   * on the force path `refused[]` stays empty and the file is deleted
   * regardless.
   */
  refused: {
    path: string;
    reason: "external-modification";
    suggestedCommand: string;
  }[];
  /**
   * True iff knowledge dir was removed for this bundle (false if absent or failed).
   * In a per-bundle result these are mutually exclusive with `knowledgeNotFound`;
   * in a `removeAllBundles` aggregate both can be true (different bundles diverged).
   */
  knowledgeRemoved: boolean;
  /** True iff knowledge dir was absent at removal time. See `knowledgeRemoved` for aggregation note. */
  knowledgeNotFound: boolean;
}

export interface UninstallerDeps {
  rmFile?: (path: string) => Promise<void>;
  rmDirIfEmpty?: (path: string) => Promise<void>;
  /** Recursive directory removal for knowledge dirs. Defaults to `rm -rf`. */
  rmDir?: (path: string) => Promise<void>;
  /** Stat for plan-time existence checks. Defaults to `node:fs/promises.stat`. */
  statFn?: (path: string) => Promise<unknown>;
  /**
   * Override the default `~/.codex` directory used when tearing down
   * refresh hooks recorded in the refresh-manifest. Tests inject a tmp dir
   * so they never touch the real codex config. Mirrors the `codexHome`
   * option on the install side (see src/cli/commands/install.ts).
   */
  codexHome?: string;
  /**
   * Override the default `~/.config/opencode` directory used when tearing
   * down the agent-smith-refresh OpenCode plugin entry. Mirrors the
   * `opencodeConfigHome` option on the install side (see
   * src/cli/commands/install.ts).
   */
  opencodeConfigHome?: string;
  /**
   * When set, signals that `removeBundle()` is performing a *partial* (filtered)
   * uninstall rather than a full uninstall. Both lists are authoritative — the
   * caller must compute them explicitly so `removeBundle` does not have to
   * second-guess what `bundle.config.targets` represents.
   *
   * Fields:
   *   - `removedTargets` — platforms being torn down by THIS call. Manifest
   *     entries for these platforms are removed from `refresh_consent.platforms`
   *     and their hooks are unregistered. Platforms recorded in the manifest
   *     but listed in NEITHER `removedTargets` nor `remainingTargets` (orphans
   *     / stale entries) are conservatively preserved — neither the hook nor
   *     the manifest entry is touched.
   *   - `remainingTargets` — platforms that will remain installed after this
   *     call. `remainingTargets` being authoritative is what enables knowledge
   *     preservation: if `remainingTargets.length > 0` the knowledge dir is
   *     kept (other platforms still depend on it). An empty `remainingTargets`
   *     is normalized to a full uninstall — knowledge is removed, the manifest
   *     is deleted, and the partial-removal branches are skipped entirely.
   *
   * Set by `runUninstallCli` (and, in Task 5, `runUninstallAllCli`) when
   * `--platforms` is a strict subset of a bundle's declared targets. Default
   * (`undefined`) preserves full-teardown behavior — every existing call site
   * is unchanged.
   */
  partialRemoval?: {
    /**
     * Platforms being torn down by THIS call. Manifest entries for these
     * platforms are removed and their hooks are unregistered.
     */
    removedTargets: PlatformId[];
    /**
     * Platforms that will remain installed after this call. An empty list is
     * normalized to a full removal (knowledge is removed, manifest deleted).
     */
    remainingTargets: PlatformId[];
  };
  /**
   * Bypass the manifest hash-mismatch refusal. Set when the user passes
   * `--force` to `smith agent uninstall|uninstall-all|destroy-agent`. The
   * file is deleted and the manifest entry cleared regardless of whether
   * the file was modified after smith installed it. Wired in Task 1.5.
   */
  force?: boolean;
  /**
   * Test seam for the installed-agents manifest's home dir. Production
   * omits and gets `stateHome()` (honors XDG_CONFIG_HOME). Mirrors the
   * `homeDir` seam on installRendered.
   */
  homeDir?: string;
}

export interface KnowledgePlan {
  bundleName: string;
  knowledgeDir: string;
  /**
   * Whether the knowledge dir exists on disk at plan time.
   * `"unknown"` is reserved for stat failures (e.g. EACCES on parent).
   */
  exists: boolean | "unknown";
  /** Plan-time error message if `exists === "unknown"`; undefined otherwise. */
  planError?: string;
}

export interface TargetPlan {
  target: Target;
  path: string;
  exists: boolean;
}

export interface UninstallPlan {
  bundleName: string;
  targets: TargetPlan[];
  knowledge: KnowledgePlan;
}

/**
 * Compute the install path for a single (name, target) pair. Mirrors the
 * logic in src/io/installer.ts targetPath() so uninstall removes exactly
 * what install wrote.
 */
export function computeUninstallPath(name: string, target: Target, paths: InstallPaths): string {
  // Mirror the per-target relativePath conventions owned by the translators
  // (src/core/translators/<target>.ts), so uninstall removes exactly what
  // install wrote.
  if (target === "codex") {
    // Codex installs agents AS skills under `<agent>/SKILL.md` per the
    // AGENTS.md convention.
    return join(paths.codex, name, "SKILL.md");
  }
  if (target === "kiro") {
    // Kiro consumes JSON agent files at `~/.kiro/agents/<name>.json`.
    return join(paths.kiro, `${name}.json`);
  }
  return join(paths[target], `${name}.md`);
}

/**
 * Enumerate every install path that `removeAllBundles` would touch for the
 * given list of bundles. Order: outer = bundle declaration order, inner =
 * target declaration order. Used by CLI commands to render plan output and
 * dry-run plans without recomputing the path list inline.
 */
export function planUninstallPaths(bundles: AgentBundle[], paths: InstallPaths): string[] {
  const out: string[] = [];
  for (const bundle of bundles) {
    for (const target of bundle.config.targets) {
      out.push(computeUninstallPath(bundle.config.name, target, paths));
    }
  }
  return out;
}

/**
 * Compute the full uninstall plan for one bundle: every target's path
 * (with installed/missing classification) plus the knowledge dir.
 *
 * Knowledge `exists` field captures stat failures as `"unknown"` so the
 * caller can render a row with status `unknown` and continue (rather than
 * silently treating the bundle as having no knowledge).
 */
export async function planUninstall(
  bundle: AgentBundle,
  paths: InstallPaths,
  knowledgePaths: KnowledgePaths,
  deps: UninstallerDeps = {},
): Promise<UninstallPlan> {
  const statFn = deps.statFn ?? stat;

  const targets: TargetPlan[] = await Promise.all(
    bundle.config.targets.map(async (target): Promise<TargetPlan> => {
      const path = computeUninstallPath(bundle.config.name, target, paths);
      try {
        await statFn(path);
        return { target, path, exists: true };
      } catch {
        // Non-ENOENT failures (e.g. EACCES) are bucketed as `exists: false`
        // because per-file targets live under the editor's config dir, where
        // stat failures are exotic and would surface again at rm-time anyway.
        // Knowledge dir uses tri-state because its parent (`agentSmithHome`)
        // is owned by us and a stat failure there is more likely to indicate
        // a real environment problem worth surfacing distinctly.
        return { target, path, exists: false };
      }
    }),
  );

  const knowledgeDir = knowledgeDirFor(bundle.config.name, knowledgePaths);
  let knowledge: KnowledgePlan;
  try {
    await statFn(knowledgeDir);
    knowledge = { bundleName: bundle.config.name, knowledgeDir, exists: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      knowledge = { bundleName: bundle.config.name, knowledgeDir, exists: false };
    } else {
      knowledge = {
        bundleName: bundle.config.name,
        knowledgeDir,
        exists: "unknown",
        planError: e?.message ?? String(err),
      };
    }
  }

  return { bundleName: bundle.config.name, targets, knowledge };
}

export interface ClassifiedPaths {
  existing: string[];
  missing: string[];
}

export async function classifyPaths(
  paths: string[],
  statFn: (p: string) => Promise<unknown> = stat,
): Promise<ClassifiedPaths> {
  const result: ClassifiedPaths = { existing: [], missing: [] };
  await Promise.all(
    paths.map(async (p) => {
      try {
        await statFn(p);
        result.existing.push(p);
      } catch {
        result.missing.push(p);
      }
    }),
  );
  return result;
}

function defaultRmFile(path: string): Promise<void> {
  return rm(path);
}

/**
 * Manifest lock path (sibling lockfile so withFileLock's wx-create doesn't
 * collide with the manifest itself). Mirrors the path used by installer.ts.
 */
function manifestLockPath(homeDir?: string): string {
  const root = homeDir ? join(homeDir, ".config/agent-smith") : stateHome();
  return join(root, "installed-agents.json.lock");
}

/**
 * Best-effort removal of an empty directory. Used to clean up the codex
 * `<agent>/` wrapper dir after its SKILL.md is removed. Swallows ENOTEMPTY
 * (user added files — leave them alone) and ENOENT (already gone).
 */
async function defaultRmDirIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // ENOTEMPTY: user dropped extra files in the codex wrapper dir; respect them.
    // ENOENT: parent already gone (e.g. SKILL.md never existed). Either is fine.
    if (e?.code !== "ENOTEMPTY" && e?.code !== "ENOENT") throw err;
  }
}

/**
 * Remove the installed copies of one bundle from every target it declares.
 * Result categorises each path: removed, notFound (ENOENT — not an error),
 * or errors (any other failure).
 *
 * Codex special-case: after removing `<agent>/SKILL.md`, attempt to rmdir
 * the wrapper directory. Only succeeds if empty — if the user dropped extra
 * files there, the dir stays intact along with their files.
 */
export async function removeBundle(
  bundle: AgentBundle,
  paths: InstallPaths,
  knowledgePaths: KnowledgePaths,
  deps: UninstallerDeps = {},
): Promise<UninstallResult> {
  const rmFile = deps.rmFile ?? defaultRmFile;
  const rmDirIfEmpty = deps.rmDirIfEmpty ?? defaultRmDirIfEmpty;
  const result: UninstallResult = {
    removed: [],
    notFound: [],
    errors: [],
    refused: [],
    knowledgeRemoved: false,
    knowledgeNotFound: false,
  };

  // Defensive normalization: an empty `remainingTargets` means the caller is
  // removing every declared platform — semantically a full uninstall. Normalize
  // here so callers can't accidentally end up on the partial-removal branch
  // (knowledge preserved, manifest rewritten with empty list) just by passing
  // `partialRemoval: { removedTargets, remainingTargets: [] }` instead of
  // `partialRemoval: undefined`.
  const isPartial =
    !!deps.partialRemoval && deps.partialRemoval.remainingTargets.length > 0;
  // `removedTargets` is only meaningful when we're on the partial branch; on
  // the full-removal branch the whole manifest is wiped regardless.
  const removedTargets: readonly PlatformId[] = isPartial
    ? (deps.partialRemoval?.removedTargets ?? [])
    : [];

  // Manifest-aware: hold the manifest lock across the per-target rm loop +
  // the manifest update so concurrent installs/uninstalls of OTHER agents
  // don't race on the manifest write. Lock duration is bounded by the
  // bundle's target list × per-rm latency (milliseconds typical).
  await withFileLock(manifestLockPath(deps.homeDir), async () => {
    let manifest = await loadInstalledAgents(
      deps.homeDir ? { homeDir: deps.homeDir } : undefined,
    );

    for (const target of bundle.config.targets) {
      const path = computeUninstallPath(bundle.config.name, target, paths);
      // Defense-in-depth [v1-task B6]: bundle name is normally validated at
      // load time but removeBundle is reached from multiple verbs. Belt-and-
      // suspenders before rm. Only assert when the install root exists —
      // a missing root would otherwise produce a containment-check ENOENT
      // that shadows the natural notFound path below.
      try {
        await stat(paths[target]);
        await assertWithin(path, paths[target]);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code !== "ENOENT") {
          result.errors.push({ path, message: e?.message ?? String(err) });
          continue;
        }
        // Root missing: fall through to rm, which will surface ENOENT as notFound.
      }

      // Manifest hash check — ONLY when smith installed this file. If there's
      // no manifest entry, fall through to the legacy rm path (existing
      // behavior preserved for files smith doesn't claim to own).
      const entry = manifest.installed.find(
        (e) => e.name === bundle.config.name && e.platform === target,
      );
      if (entry !== undefined && entry.path === path && !deps.force) {
        let onDisk: string | undefined;
        try {
          onDisk = await readFile(path, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            // Unreadable for some other reason; let the rm attempt below
            // surface the real error rather than refusing on incomplete info.
            onDisk = undefined;
          }
        }
        if (onDisk !== undefined) {
          const currentHash = hashContent(onDisk);
          if (currentHash !== entry.contentHash) {
            // Refuse to delete an externally-modified smith file.
            result.refused.push({
              path,
              reason: "external-modification",
              suggestedCommand: `smith agent uninstall ${bundle.config.name} --force`,
            });
            // Skip rm AND the manifest entry removal — both preserved.
            // Skip codex wrapper rmdir since the SKILL.md file is preserved.
            continue;
          }
        }
      }

      // Existing rm + codex wrapper rmdir behavior (preserved).
      try {
        await rmFile(path);
        result.removed.push(path);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === "ENOENT") {
          result.notFound.push(path);
        } else {
          // Defensive: handle non-Error throws (e.g. `throw "boom"`) which have no `.message`.
          result.errors.push({ path, message: e?.message ?? String(err) });
          // Failed rm → don't touch the manifest entry.
          continue;
        }
      }
      if (target === "codex") {
        try {
          await rmDirIfEmpty(dirname(path));
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          result.errors.push({ path: dirname(path), message: e?.message ?? String(err) });
        }
      }

      // Manifest update: clear this (name, platform) entry on success.
      // Both removed and notFound buckets clear the entry — the manifest's
      // view is now consistent with disk.
      if (entry !== undefined) {
        manifest = removeInstalledAgent(
          manifest,
          (e) => e.name === bundle.config.name && e.platform === target,
        );
      }
    }

    await saveInstalledAgents(
      manifest,
      deps.homeDir ? { homeDir: deps.homeDir } : undefined,
    );
  });

  // Knowledge removal AFTER platform files. Failures aggregated into errors.
  // Pass full deps through so `removeBundleKnowledge` picks up `rmDir`
  // (and any future deps land automatically without additional plumbing).
  // Partial removal: skip knowledge teardown — other platforms still depend
  // on the materialized sources.
  if (!isPartial) {
    const kn = await removeBundleKnowledge(bundle.config.name, knowledgePaths, deps);
    result.knowledgeRemoved = kn.removed;
    result.knowledgeNotFound = kn.notFound;
    if (kn.error) result.errors.push(kn.error);
  }

  // Refresh manifest cleanup AFTER knowledge. The manifest records which
  // platforms had refresh hooks installed for this agent; we read it first
  // so we can undo the platform-specific hook registration before deleting
  // (or rewriting) the record itself. The final manifest mutation is
  // idempotent (rm with force:true / writeFile overwrite). Failures
  // aggregated into errors with the manifest path.
  try {
    const manifest = await readRefreshManifest(knowledgePaths.agentSmithHome, bundle.config.name);
    if (manifest) {
      const codexHome = deps.codexHome ?? defaultCodexHome();
      const opencodeHome = deps.opencodeConfigHome ?? defaultOpencodeConfigHome();
      // Hook teardown is scoped to `removedTargets` on the partial branch:
      // for each platform recorded in the manifest, unregister its hook only
      // if it's explicitly being torn down. Platforms in `remainingTargets`
      // OR orphans (in the manifest but in NEITHER list) are left intact —
      // the orphan case represents a stale or external manifest entry that
      // this call has no authority to remove. On the full-removal branch
      // (`!isPartial`) every recorded platform is torn down.
      for (const platform of manifest.refresh_consent.platforms) {
        if (isPartial && !removedTargets.includes(platform)) continue;
        if (platform === "codex") {
          await removeAgentFromCodexHooks(codexHome, bundle.config.name);
        }
        if (platform === "opencode") {
          // Phase 5: tear down the agent's entry in the shared
          // agent-smith-refresh plugin sentinel. When the last consenting
          // agent is removed, the plugin dir + opencode.json entry are
          // deleted entirely (see unregisterAgentFromOpencodePlugin).
          await unregisterAgentFromOpencodePlugin(opencodeHome, bundle.config.name);
        }
        // claude-code: refresh hook frontmatter lives inside the agent file
        // (just deleted above) — nothing else to clean up.
      }

      if (isPartial) {
        // Rewrite the manifest dropping only the explicitly-removed platforms.
        // Orphans (platforms in the manifest but in neither `removedTargets`
        // nor `remainingTargets`) are conservatively preserved here as well.
        // If the rewrite empties the list, delete the manifest entirely
        // (consistent with the full-uninstall branch below).
        const remaining = manifest.refresh_consent.platforms.filter(
          (p) => !removedTargets.includes(p),
        );
        if (remaining.length === 0) {
          await removeRefreshManifest(knowledgePaths.agentSmithHome, bundle.config.name);
        } else {
          await writeRefreshManifest(knowledgePaths.agentSmithHome, bundle.config.name, {
            ...manifest,
            refresh_consent: { ...manifest.refresh_consent, platforms: remaining },
          });
        }
      } else {
        await removeRefreshManifest(knowledgePaths.agentSmithHome, bundle.config.name);
      }
    } else if (!isPartial) {
      // No manifest, full uninstall: idempotent removal (covers the "no-op
      // when refresh-manifest.json is absent" test).
      await removeRefreshManifest(knowledgePaths.agentSmithHome, bundle.config.name);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    result.errors.push({
      path: join(
        knowledgePaths.agentSmithHome,
        "agents",
        bundle.config.name,
        "refresh-manifest.json",
      ),
      message: e?.message ?? String(err),
    });
  }

  return result;
}

/** Recursive removal that preserves ENOENT so the caller can report notFound. */
function defaultRmDir(path: string): Promise<void> {
  return rm(path, { recursive: true, force: false });
}

export interface RemoveKnowledgeResult {
  removed: boolean;
  notFound: boolean;
  error?: { path: string; message: string };
}

/**
 * Defense-in-depth path-traversal guard for bundle names that reach
 * `rm -rf`. Mirrors `skill-installer`'s SAFE_SKILL_NAME_RE rationale:
 * upstream config-schema validation is the primary gate, but a demolition
 * helper that takes a raw string deserves its own check. Empty name,
 * `..`, leading `.`, slashes, or backslashes all reject without touching
 * disk. Surfaces as the standard `error` envelope with `path` set to the
 * bare bundle name so callers can render a sensible message.
 */
function validateBundleName(name: string): { ok: true } | { ok: false; reason: string } {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.startsWith(".")
  ) {
    return {
      ok: false,
      reason: `invalid bundle name '${name}': empty, contains '/' or '\\\\', '..', or leading '.'`,
    };
  }
  return { ok: true };
}

/**
 * Recursively remove a bundle's materialized knowledge dir at
 * `<agentSmithHome>/knowledge/<name>/` (which contains `.cache/` and any
 * materialized source files). ENOENT is reported as `notFound` (not an error).
 * Any other failure is reported in `error` and the caller decides exit code.
 *
 * Bundle name is validated as a path-traversal guard before any filesystem
 * call — see `validateBundleName`.
 */
export async function removeBundleKnowledge(
  bundleName: string,
  knowledgePaths: KnowledgePaths,
  deps: UninstallerDeps = {},
): Promise<RemoveKnowledgeResult> {
  const guard = validateBundleName(bundleName);
  if (!guard.ok) {
    return {
      removed: false,
      notFound: false,
      error: { path: bundleName, message: guard.reason },
    };
  }
  const rmDir = deps.rmDir ?? defaultRmDir;
  const knowledgeDir = knowledgeDirFor(bundleName, knowledgePaths);
  // Defense-in-depth [v1-task B6]: validateBundleName above is the
  // primary gate; this is belt-and-suspenders so a future caller that
  // bypasses validateBundleName still cannot rm -rf outside agentSmithHome.
  // Only assert when the home dir exists — otherwise rmDir will surface
  // ENOENT as notFound below.
  try {
    await stat(knowledgePaths.agentSmithHome);
    await assertWithin(knowledgeDir, knowledgePaths.agentSmithHome);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== "ENOENT") {
      return {
        removed: false,
        notFound: false,
        error: { path: knowledgeDir, message: e?.message ?? String(err) },
      };
    }
    // Home missing: fall through to rmDir for normal notFound handling.
  }
  try {
    await rmDir(knowledgeDir);
    return { removed: true, notFound: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      return { removed: false, notFound: true };
    }
    return {
      removed: false,
      notFound: false,
      error: { path: knowledgeDir, message: e?.message ?? String(err) },
    };
  }
}

/**
 * Remove installed copies for many bundles. Aggregates per-bundle results
 * into a single UninstallResult. One bundle's failure does not stop others.
 */
export async function removeAllBundles(
  bundles: AgentBundle[],
  paths: InstallPaths,
  knowledgePaths: KnowledgePaths,
  deps: UninstallerDeps = {},
): Promise<UninstallResult> {
  const total: UninstallResult = {
    removed: [],
    notFound: [],
    errors: [],
    refused: [],
    knowledgeRemoved: false,
    knowledgeNotFound: false,
  };
  for (const bundle of bundles) {
    const r = await removeBundle(bundle, paths, knowledgePaths, deps);
    total.removed.push(...r.removed);
    total.notFound.push(...r.notFound);
    total.errors.push(...r.errors);
    total.refused.push(...r.refused);
    // For uninstall-all, the per-bundle knowledge flags are coarse — at least one
    // removed sets the aggregate true. Callers needing per-bundle detail should
    // call removeBundle directly.
    if (r.knowledgeRemoved) total.knowledgeRemoved = true;
    if (r.knowledgeNotFound) total.knowledgeNotFound = true;
  }
  return total;
}
