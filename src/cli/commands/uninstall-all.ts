import pc from "picocolors";
import { SmithError } from "../../core/smith-error";
import { EXIT_OK, EXIT_PARTIAL, EXIT_RUNTIME } from "../exit-codes";
import type { AgentBundle, InstallPaths } from "../../core/types";
import type { KnowledgePaths } from "../../io/knowledge-paths";
import type { PlatformId } from "../../io/platform-detect";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import type { Registry } from "../../io/registry";
import { planUninstall, removeBundle, type UninstallResult } from "../../io/uninstaller";
import type { UninstallerDeps } from "../../io/uninstaller";
import { defaultInstallPaths, defaultKnowledgePaths } from "../install-paths";
import { renderUninstallTable } from "../render/uninstall-table";
import { loadAllBundles, type LoadAllBundlesResult, warnAllLoadFailures } from "../load-all";
import { readToken as defaultReadToken } from "../prompt";

export interface UninstallAllCliOptions {
  dryRun?: boolean;
  yes?: boolean;
  paths?: InstallPaths;
  knowledgePaths?: KnowledgePaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  rmFile?: (path: string) => Promise<void>;
  rmDir?: (path: string) => Promise<void>;
  statFile?: (path: string) => Promise<unknown>;
  readToken?: (prompt: string) => Promise<string>;
  print?: (msg: string) => void;
  /** When set, each bundle is scoped to the intersection of this list and
   *  its declared targets. Bundles with empty intersection are skipped with
   *  a stdout warn (matching install-all's per-agent skip behavior). When
   *  the filter is a strict subset of a bundle's declared targets, a
   *  `partialRemoval` hint is forwarded to `removeBundle()` so shared state
   *  (knowledge dir, hooks for remaining platforms, the rest of the refresh
   *  manifest) is preserved for THAT bundle. */
  platformFilter?: PlatformId[];
  /**
   * Bypass the manifest hash-mismatch refusal across every bundle. Wired to
   * the `--force` CLI flag in Task 1.5. With force, externally-modified
   * smith files are deleted regardless of drift.
   */
  force?: boolean;
  /**
   * Test seam for the installed-agents manifest's home dir. Threaded
   * through to each `removeBundle` call.
   */
  homeDir?: string;
}

const pl = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export async function runUninstallAllCli(opts: UninstallAllCliOptions): Promise<number> {
  const paths = opts.paths ?? defaultInstallPaths();
  const knowledgePaths = opts.knowledgePaths ?? defaultKnowledgePaths();
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const readToken = opts.readToken ?? defaultReadToken;
  const print = opts.print ?? ((m: string) => console.log(m));

  const registry = await loadReg(canonicalRegistryPath());
  const loadResult = await loadBundles(registry);
  const bundles = loadResult.bundles;
  warnAllLoadFailures(loadResult.failures, print);
  // Empty-registry early exit must run BEFORE the --platforms filter so a
  // genuinely empty registry still surfaces "No agents registered." rather
  // than silently dropping into the filter loop.
  if (bundles.length === 0 && loadResult.failures.length === 0) {
    print(pc.dim("No agents registered."));
    return EXIT_OK;
  }

  // Apply --platforms filter once, up front, so plan + remove see the same
  // scoped target list. Bundles with no overlap are dropped with a
  // user-visible "skipping" line so the plan table reflects reality. Each
  // scoped entry also carries a `partialRemoval` hint when the filter is a
  // strict subset of the bundle's declared targets — the entry is consumed
  // by the per-bundle removeBundle() call below so shared state (knowledge
  // dir, hooks for remaining platforms) is preserved per bundle.
  type Scoped = {
    bundle: AgentBundle;
    partialRemoval?: { removedTargets: PlatformId[]; remainingTargets: PlatformId[] };
  };
  const scoped: Scoped[] = [];
  if (opts.platformFilter && opts.platformFilter.length > 0) {
    const filter = opts.platformFilter;
    for (const bundle of bundles) {
      const declared = bundle.config.targets as PlatformId[];
      const kept = declared.filter((t) => filter.includes(t));
      if (kept.length === 0) {
        print(
          pc.yellow(
            `warn skipping ${bundle.config.name}: no targets match --platforms ${filter.join(",")}`,
          ),
        );
        continue;
      }
      const remaining = declared.filter((t) => !kept.includes(t));
      scoped.push({
        bundle: { ...bundle, config: { ...bundle.config, targets: kept } },
        ...(remaining.length > 0
          ? { partialRemoval: { removedTargets: kept, remainingTargets: remaining } }
          : {}),
      });
    }
  } else {
    scoped.push(...bundles.map((b) => ({ bundle: b })));
  }
  const scopedBundles = scoped.map((s) => s.bundle);

  const planDeps: UninstallerDeps = {};
  if (opts.statFile) planDeps.statFn = opts.statFile;
  const plans = await Promise.all(
    scopedBundles.map((b) => planUninstall(b, paths, knowledgePaths, planDeps)),
  );

  print(pc.bold(`Plan: ${pl(scopedBundles.length, "agent")}`));
  print("");
  for (const line of renderUninstallTable(plans, { perBundleHeader: true })) print(line);
  print("");

  if (opts.dryRun) {
    print(pc.dim("DRY RUN — no changes made."));
    return EXIT_OK;
  }

  if (!opts.yes) {
    const answer = (await readToken("Continue? [y/N] ")).toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      print(pc.dim("Aborted."));
      return EXIT_RUNTIME;
    }
  }

  print(`Removing ${pl(scopedBundles.length, "agent")}...`);
  const depOverrides: UninstallerDeps = {};
  if (opts.rmFile) depOverrides.rmFile = opts.rmFile;
  if (opts.rmDir) depOverrides.rmDir = opts.rmDir;

  // Wire the global --force / homeDir options into deps for every per-bundle
  // call. depOverrides was constructed earlier with rmFile/rmDir/etc.
  if (opts.force === true) depOverrides.force = true;
  if (opts.homeDir !== undefined) depOverrides.homeDir = opts.homeDir;

  // Per-bundle loop (vs. removeAllBundles) so each entry's `partialRemoval`
  // hint can be threaded individually. The aggregate shape matches what
  // removeAllBundles would have returned.
  const result: UninstallResult = {
    removed: [],
    notFound: [],
    errors: [],
    refused: [],
    knowledgeRemoved: false,
    knowledgeNotFound: false,
  };
  for (const entry of scoped) {
    const r = await removeBundle(entry.bundle, paths, knowledgePaths, {
      ...depOverrides,
      ...(entry.partialRemoval ? { partialRemoval: entry.partialRemoval } : {}),
    });
    result.removed.push(...r.removed);
    result.notFound.push(...r.notFound);
    result.errors.push(...r.errors);
    result.refused.push(...r.refused);
    if (r.knowledgeRemoved) result.knowledgeRemoved = true;
    if (r.knowledgeNotFound) result.knowledgeNotFound = true;
  }

  // Refusals across all bundles aggregate into one SmithError so the user
  // gets one actionable error message rather than a quiet partial-success.
  if (result.refused.length > 0) {
    const first = result.refused[0]!;
    throw new SmithError({
      code: "already-exists",
      what: `agent file modified externally`,
      identifier: result.refused.map((r) => r.path).join(", "),
      suggestedCommand: first.suggestedCommand,
    });
  }

  // Tradeoff (Task 11): per-bundle knowledge results are NOT printed here.
  // The plan table at the top already showed which bundles have knowledge,
  // and knowledge failures still surface via result.errors (exit 3).
  for (const p of result.removed) print(pc.green(`✓ removed: ${p}`));
  for (const p of result.notFound) print(pc.dim(`- not found: ${p}`));
  for (const e of result.errors) print(pc.red(`✗ failed: ${e.path} (${e.message})`));
  print(`Removed ${pl(result.removed.length, "file")}. Source bundles remain registered.`);

  return result.errors.length > 0 ? EXIT_PARTIAL : EXIT_OK;
}
