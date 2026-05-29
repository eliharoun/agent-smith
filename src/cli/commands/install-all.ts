import pc from "picocolors";
import type { AgentBundle, InstallPaths } from "../../core/types";
import type { InstallRequiredSkillsMode } from "../../io/install-required-skills";
import type {
  BuildAndInstallOptions,
  OrchestratorResult,
} from "../../io/orchestrator";
import type { PlatformId } from "../../io/platform-detect";
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
    const code = await install({
      name: bundle.config.name,
      paths,
      // Reuse already-loaded registry/bundles to avoid re-reading per agent.
      loadRegistry: async () => reg,
      loadAllBundles: async () => ({ bundles, failures: [] }),
      ...(opts.buildAndInstall ? { buildAndInstall: opts.buildAndInstall } : {}),
      ...(opts.skillMode ? { skillMode: opts.skillMode } : {}),
      ...(opts.platformFilter ? { platformFilter: opts.platformFilter } : {}),
      ...(opts.allowMissingMcp ? { allowMissingMcp: true } : {}),
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
