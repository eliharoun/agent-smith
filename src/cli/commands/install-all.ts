import pc from "picocolors";
import type { AgentBundle, InstallPaths, Target } from "../../core/types";
import type { InstallRequiredSkillsMode } from "../../io/install-required-skills";
import type {
  BuildAndInstallOptions,
  OrchestratorResult,
} from "../../io/orchestrator";
import {
  detectInstalledPlatforms as defaultDetectInstalledPlatforms,
  type PlatformId,
} from "../../io/platform-detect";
import {
  renderSkippedPlatforms,
  resolveExecutionPlatforms,
} from "../../io/platform-execution";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import type { Registry } from "../../io/registry";
import type { RefreshConsentParsed } from "../parse-refresh-consent";
import { defaultInstallPaths } from "../install-paths";
import { aggregateLoadFailures, loadAllBundles, type LoadAllBundlesResult, warnAllLoadFailures } from "../load-all";
import { install } from "./install";

export interface InstallAllCliOptions {
  paths?: InstallPaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  buildAndInstall?: (
    bundles: AgentBundle[],
    paths: InstallPaths,
    options?: BuildAndInstallOptions,
  ) => Promise<OrchestratorResult>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  /** Required-skills handling: forwarded per-agent to `install()`. */
  skillMode?: InstallRequiredSkillsMode;
  loadInstalledSkillNames?: () => Promise<string[]>;
  installSkillByRef?: (ref: string) => Promise<void>;
  prompt?: (msg: string) => Promise<string>;
  isTTY?: () => boolean;
  /** Forwarded per-agent to `install()`. When set, agents whose declared
   *  targets do not intersect this list are skipped with a stderr warning
   *  rather than aborting the run. */
  platformFilter?: PlatformId[];
  /** Forwarded per-agent to `install()`. See InstallCliOptions for v1-task B7. */
  allowMissingMcp?: boolean;
  /** Forwarded per-agent to `install()`. See InstallCliOptions. */
  allowMissingCli?: boolean;
  /** v1-task B1: forwarded per-agent to `install()`. When set, the
   *  refresh-hook consent prompt is pre-answered uniformly. Resolved
   *  from `--refresh-consent` or the `--yes` cascade in the action
   *  handler via {@link resolveInstallRefreshConsent}. */
  refreshConsent?: RefreshConsentParsed;
  /**
   * Forwarded per-agent to `install()`. When set, the would-clobber refusal
   * is bypassed for every agent in the run. CLI flag: `--force`.
   */
  force?: boolean;
  /**
   * Forwarded per-agent to `install()`. PlatformConventions resolution
   * strategy. CLI flag: `--platform-conventions <strategy>`.
   */
  platformConventions?: import("../../io/conventions").DefaultStrategy;
  /**
   * DI seam for platform detection. Production omits and gets
   * `detectInstalledPlatforms()` from `io/platform-detect`. Detected once
   * per `installAll` invocation and forwarded to each per-agent `install()`
   * call so every bundle in the run is gated against the same platform
   * topology — no per-bundle re-detection drift, no speculative writes to
   * platforms missing from PATH. Tests inject a fixed `Set<PlatformId>` to
   * exercise the gating without touching the runner's PATH.
   */
  detectInstalledPlatforms?: () => Promise<Set<PlatformId>>;
}

/**
 * Build and install every known agent. Iterates by delegating each agent to
 * `install()`, so per-agent required-skills resolution (spec §8.3) runs for
 * every entry — install-all does NOT bypass the orchestration.
 */
export async function installAll(opts: InstallAllCliOptions = {}): Promise<number> {
  const paths = opts.paths ?? defaultInstallPaths();
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const print = opts.print ?? ((m: string) => console.log(m));
  const printErr = opts.printErr ?? ((m: string) => console.error(m));

  const reg = await loadReg(canonicalRegistryPath());
  const result = await loadBundles(reg);
  const bundles = result.bundles;
  warnAllLoadFailures(result.failures, printErr);
  if (bundles.length === 0 && result.failures.length === 0) {
    print(pc.green("Installed 0 files"));
    return 0;
  }

  // Detect platforms once for the whole run. Forwarded to each per-agent
  // `install()` call so every bundle is gated against the same platform
  // topology — avoids per-bundle re-detection drift and speculative writes
  // to platforms missing from PATH for `modelTier: "inherit"` agents.
  const installedPlatforms = await (
    opts.detectInstalledPlatforms ?? defaultDetectInstalledPlatforms
  )();
  const detectedFn = async (): Promise<Set<PlatformId>> => installedPlatforms;

  // Helper: a Target value is also a PlatformId when it names a platform
  // with a CLI dependency. `agents-md` is a Target with no platform CLI and
  // is preserved in the targets list as-is below.
  const isPlatformId = (t: Target): t is PlatformId =>
    t === "opencode" || t === "claude-code" || t === "codex" || t === "kiro";

  let exitCode = 0;
  for (const bundle of bundles) {
    if (opts.platformFilter && opts.platformFilter.length > 0) {
      const declared = bundle.config.targets;
      // Widen the filter to readonly string[] for the membership check;
      // PlatformId and Target are structurally identical today (see
      // applyPlatformFilter in install.ts for the same pattern).
      const filterAsStrings: readonly string[] = opts.platformFilter;
      const overlap = declared.filter((t) => filterAsStrings.includes(t));
      if (overlap.length === 0) {
        printErr(
          `${pc.yellow("warn")} skipping ${bundle.config.name}: no targets match --platforms ${opts.platformFilter.join(",")}` +
            ` (declared: ${declared.length === 0 ? "none" : declared.join(", ")})`,
        );
        continue;
      }
    }

    // Compute the execution plan per bundle and narrow declared targets to
    // detected (or force-filtered) platforms before delegating to
    // `install()`. Mirrors the gating in `install()` itself; pre-narrowing
    // here keeps the bulk-install path honest and emits the skipped
    // one-liner per bundle so the run output explains every absent target.
    // `agents-md` is preserved (no CLI dependency).
    const plan = resolveExecutionPlatforms({
      manifestTargets: bundle.config.targets.filter(isPlatformId),
      installed: installedPlatforms,
      ...(opts.platformFilter
        ? {
            forceFilter: opts.platformFilter.filter((t): t is PlatformId =>
              isPlatformId(t as Target),
            ),
          }
        : {}),
    });
    const skipped = renderSkippedPlatforms(plan);
    if (skipped.length > 0) printErr(skipped);
    const targetsForRender: Target[] = [
      ...plan.execution,
      ...bundle.config.targets.filter((t) => t === "agents-md"),
    ];
    const narrowedBundle: AgentBundle =
      targetsForRender.length === bundle.config.targets.length
        ? bundle
        : { ...bundle, config: { ...bundle.config, targets: targetsForRender } };

    // Replace the bundle in the loaded list so the inner `install()`
    // receives the narrowed view via its `loadAllBundles` DI. Cloning the
    // array keeps the outer `bundles` reference untouched for downstream
    // partial-failure aggregation.
    const bundlesForInner = bundles.map((b) =>
      b.config.name === narrowedBundle.config.name ? narrowedBundle : b,
    );

    const code = await install({
      name: bundle.config.name,
      paths,
      // Reuse already-loaded registry/bundles to avoid re-reading per agent.
      loadRegistry: async () => reg,
      loadAllBundles: async () => ({ bundles: bundlesForInner, failures: [] }),
      // Forward the once-detected platform set so the inner install()'s
      // gating runs against the same topology (and, since targets are
      // already narrowed, its skipped one-liner stays silent — no double
      // print).
      detectInstalledPlatforms: detectedFn,
      ...(opts.buildAndInstall ? { buildAndInstall: opts.buildAndInstall } : {}),
      ...(opts.skillMode ? { skillMode: opts.skillMode } : {}),
      ...(opts.platformFilter ? { platformFilter: opts.platformFilter } : {}),
      ...(opts.allowMissingMcp ? { allowMissingMcp: true } : {}),
      ...(opts.allowMissingCli ? { allowMissingCli: true } : {}),
      ...(opts.refreshConsent ? { refreshConsent: opts.refreshConsent } : {}),
      ...(opts.force ? { force: true } : {}),
      ...(opts.platformConventions
        ? { platformConventions: opts.platformConventions }
        : {}),
      ...(opts.loadInstalledSkillNames
        ? { loadInstalledSkillNames: opts.loadInstalledSkillNames }
        : {}),
      ...(opts.installSkillByRef ? { installSkillByRef: opts.installSkillByRef } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      ...(opts.isTTY ? { isTTY: opts.isTTY } : {}),
      print,
      printErr,
    });
    if (code !== 0) exitCode = code;
  }

  // When the loaded subset all installed cleanly but other bundles failed
  // to load, surface those load failures via the partial-failure envelope.
  // If exitCode is already non-zero, the inner install errors dominate the
  // exit signal — load failures were warned at top so they aren't lost.
  if (exitCode === 0) {
    const err = aggregateLoadFailures("install all", bundles.length, result.failures);
    if (err) throw err;
  }
  return exitCode;
}
