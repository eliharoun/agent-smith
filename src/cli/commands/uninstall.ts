import pc from "picocolors";
import { SmithError } from "../../core/smith-error";
import type { AgentBundle, InstallPaths, Target } from "../../core/types";
import type { KnowledgePaths } from "../../io/knowledge-paths";
import { detectInstalledPlatforms } from "../../io/platform-detect";
import type { PlatformId } from "../../io/platform-detect";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import type { Registry } from "../../io/registry";
import { planUninstall, removeBundle } from "../../io/uninstaller";
import type { UninstallerDeps } from "../../io/uninstaller";
import { EXIT_OK, EXIT_PARTIAL } from "../exit-codes";
import { defaultInstallPaths, defaultKnowledgePaths } from "../install-paths";
import { renderUninstallTable } from "../render/uninstall-table";
import {
  findBundleOrFail,
  loadAllBundles,
  type LoadAllBundlesResult,
  warnUnrelatedLoadFailures,
} from "../load-all";
import { guardProtectedAgent } from "./protected-confirm";

export interface UninstallCliOptions {
  name: string;
  dryRun?: boolean;
  paths?: InstallPaths;
  knowledgePaths?: KnowledgePaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  rmFile?: (path: string) => Promise<void>;
  rmDir?: (path: string) => Promise<void>;
  statFile?: (path: string) => Promise<unknown>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  /** When set, restricts uninstall to the intersection of this list and the
   *  agent's declared targets. Throws `usage-error` if the intersection is
   *  empty. Default: uninstall from all declared targets. */
  platformFilter?: PlatformId[];
  /**
   * Bypass the manifest hash-mismatch refusal. When `true`, externally-
   * modified smith files are deleted regardless of drift. Mirrors the
   * `--force` CLI flag wired in Task 1.5.
   */
  force?: boolean;
  /**
   * Test seam for the installed-agents manifest's home dir. Threaded
   * through to `removeBundle`. Production omits.
   */
  homeDir?: string;
  /**
   * DI seam for platform detection. Production calls
   * `detectInstalledPlatforms()` which probes PATH for each platform's
   * CLI binary; tests inject a deterministic set. Used to distinguish
   * "platform not installed" from "file just missing" in the print loop.
   */
  detectInstalledPlatforms?: () => Promise<Set<PlatformId>>;
  /** DI seam for the clone-mode confirmation prompt. Defaults to readToken. */
  confirmFn?: (question: string) => Promise<string>;
}

export async function runUninstallCli(opts: UninstallCliOptions): Promise<number> {
  await guardProtectedAgent(opts.name, "uninstall", opts.confirmFn);
  const paths = opts.paths ?? defaultInstallPaths();
  const knowledgePaths = opts.knowledgePaths ?? defaultKnowledgePaths();
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const print = opts.print ?? ((m: string) => console.log(m));
  const printErr = opts.printErr ?? ((m: string) => console.error(m));
  const detectPlatforms = opts.detectInstalledPlatforms ?? detectInstalledPlatforms;
  const installedPlatforms = await detectPlatforms();

  const registry = await loadReg(canonicalRegistryPath());
  const result = await loadBundles(registry);

  // Surface unrelated load failures as warnings before lookup. The basename
  // check avoids double-reporting the target failure (findBundleOrFail
  // re-surfaces it as a partial-failure SmithError below).
  warnUnrelatedLoadFailures(result.failures, opts.name, printErr);

  // Throws partial-failure if the target was in failures (basename match),
  // or not-found if neither bundles nor failures match.
  const bundle = findBundleOrFail(result, opts.name);

  const filteredBundle = applyPlatformFilter(bundle, opts.platformFilter);

  // Compute the partial-removal hint by diffing the unfiltered declared
  // targets against the (post-filter) targets. Non-empty `remainingTargets`
  // means at least one declared platform is being preserved — pass both
  // lists to `removeBundle` so shared state (knowledge dir, hooks for other
  // platforms, the rest of the refresh manifest) is left intact. Both lists
  // are required: `removedTargets` drives hook teardown + manifest filtering,
  // `remainingTargets` drives the knowledge-preservation branch.
  const declaredTargets = bundle.config.targets as readonly PlatformId[];
  const filteredTargets = filteredBundle.config.targets as readonly PlatformId[];
  const remainingTargets = declaredTargets.filter((t) => !filteredTargets.includes(t));
  const partialRemoval =
    remainingTargets.length > 0
      ? {
          removedTargets: [...filteredTargets],
          remainingTargets: [...remainingTargets],
        }
      : undefined;

  const planDeps: UninstallerDeps = {};
  if (opts.statFile) planDeps.statFn = opts.statFile;
  const plan = await planUninstall(filteredBundle, paths, knowledgePaths, planDeps);

  print(pc.bold(`Plan for "${filteredBundle.config.name}":`));
  for (const line of renderUninstallTable([plan])) print(line);
  print("");

  if (opts.dryRun) {
    print(pc.dim("DRY RUN — no changes made."));
    return EXIT_OK;
  }

  const depOverrides: UninstallerDeps = {};
  if (opts.rmFile) depOverrides.rmFile = opts.rmFile;
  if (opts.rmDir) depOverrides.rmDir = opts.rmDir;
  if (opts.force === true) depOverrides.force = true;
  if (opts.homeDir !== undefined) depOverrides.homeDir = opts.homeDir;
  const removeResult = await removeBundle(filteredBundle, paths, knowledgePaths, {
    ...depOverrides,
    ...(partialRemoval ? { partialRemoval } : {}),
  });

  // Refused files (manifest hash drift) → SmithError with --force suggestion.
  // Translated here so the CLI surfaces a single actionable error rather than
  // a quiet partial-success the user can miss.
  if (removeResult.refused.length > 0) {
    const first = removeResult.refused[0]!;
    throw new SmithError({
      code: "already-exists",
      what: `agent file modified externally`,
      identifier: removeResult.refused.map((r) => r.path).join(", "),
      suggestedCommand: first.suggestedCommand,
    });
  }

  // Spec requires the per-file groups to print in this order: removed, notFound, errors.
  // Errors go to stderr to match install.ts (CLI-18) — both commands
  // use the same red "✗" + exit 3 contract for filesystem failures, so
  // the stream choice should match. removed/notFound stay on stdout.
  //
  // Classify each notFound path by which platform's install dir it lives
  // under: when that platform's CLI isn't on PATH, render the friendlier
  // "not installed — skipped" line instead of the misleading "not
  // found:". Match by directory prefix (with a trailing separator) so
  // both the main file and any sidecars rooted under `paths[target]`
  // resolve to the same target. `agents-md` is treated as always
  // installed (file-only target, no CLI dependency).
  //
  // Each platform's "skipped" line is emitted at most once per run, even
  // if multiple notFound paths share the platform.
  const targetDirEntries = (Object.entries(paths) as [Target, string][]).map(
    ([target, dir]) => [target, dir.endsWith("/") ? dir : `${dir}/`] as const,
  );
  function classifyNotFoundPath(p: string): Target | undefined {
    for (const [target, prefix] of targetDirEntries) {
      if (p === prefix.slice(0, -1) || p.startsWith(prefix)) return target;
    }
    return undefined;
  }
  for (const p of removeResult.removed) print(pc.green(`✓ removed: ${p}`));
  const skippedPlatformsPrinted = new Set<PlatformId>();
  for (const p of removeResult.notFound) {
    const target = classifyNotFoundPath(p);
    if (
      target !== undefined &&
      target !== "agents-md" &&
      !installedPlatforms.has(target as PlatformId)
    ) {
      const platformId = target as PlatformId;
      if (!skippedPlatformsPrinted.has(platformId)) {
        skippedPlatformsPrinted.add(platformId);
        print(pc.dim(`~ ${platformId}: not installed — skipped`));
      }
    } else {
      print(pc.dim(`- not found: ${p}`));
    }
  }
  if (removeResult.knowledgeRemoved) {
    print(pc.green(`✓ removed: ${plan.knowledge.knowledgeDir}`));
  } else if (removeResult.knowledgeNotFound) {
    print(pc.dim(`- not found: ${plan.knowledge.knowledgeDir}`));
  }
  for (const e of removeResult.errors) printErr(pc.red(`✗ failed: ${e.path} (${e.message})`));

  return removeResult.errors.length > 0 ? EXIT_PARTIAL : EXIT_OK;
}

/**
 * Restrict a bundle's `config.targets` to the intersection with `filter`.
 * Returns the original bundle when `filter` is undefined or empty.
 * Throws `usage-error` SmithError when the intersection is empty so the
 * caller fails fast instead of silently uninstalling nothing.
 *
 * Order is preserved from the bundle's declared targets (not the filter),
 * to keep per-agent uninstall order stable across invocations.
 */
function applyPlatformFilter(
  bundle: AgentBundle,
  filter: PlatformId[] | undefined,
): AgentBundle {
  if (!filter || filter.length === 0) return bundle;
  const declared: Target[] = bundle.config.targets;
  const filterAsStrings: readonly string[] = filter;
  const kept = declared.filter((t) => filterAsStrings.includes(t));
  if (kept.length === 0) {
    throw new SmithError({
      code: "usage-error",
      message:
        `agent '${bundle.config.name}' has no targets matching --platforms ${filter.join(",")} ` +
        `(declared: ${declared.length === 0 ? "none" : declared.join(", ")})`,
    });
  }
  return {
    ...bundle,
    config: { ...bundle.config, targets: kept },
  };
}
