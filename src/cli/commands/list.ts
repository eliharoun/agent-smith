import { stat } from "node:fs/promises";
import pc from "picocolors";
import type { AgentBundle, InstallPaths, Target } from "../../core/types";
import type { Registry } from "../../io/registry";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { computeUninstallPath } from "../../io/uninstaller";
import { defaultInstallPaths } from "../install-paths";
import { type LoadAllBundlesResult, loadAllBundles, warnAllLoadFailures } from "../load-all";

export interface ListCliOptions {
  paths?: InstallPaths;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  statFile?: (path: string) => Promise<unknown>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

async function isInstalled(
  bundle: AgentBundle,
  target: Target,
  paths: InstallPaths,
  statFn: (p: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    await statFn(computeUninstallPath(bundle.config.name, target, paths));
    return true;
  } catch {
    return false;
  }
}

export async function runListCli(opts: ListCliOptions = {}): Promise<number> {
  const paths = opts.paths ?? defaultInstallPaths();
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const statFn = opts.statFile ?? stat;
  const print = opts.print ?? ((m: string) => console.log(m));
  const printErr = opts.printErr ?? ((m: string) => console.error(m));

  const reg = await loadReg(canonicalRegistryPath());
  const result = await loadBundles(reg);
  warnAllLoadFailures(result.failures, printErr);
  const bundles = result.bundles;
  if (bundles.length === 0 && result.failures.length === 0) {
    print(pc.dim("(no agents found in any catalog)"));
    return 0;
  }
  for (const b of bundles) {
    const targetMarkers = await Promise.all(
      b.config.targets.map(async (t) => {
        const installed = await isInstalled(b, t, paths, statFn);
        return installed ? pc.green(`${t} ✓`) : pc.dim(`${t} ✗`);
      }),
    );
    print(
      [
        pc.bold(b.config.name),
        pc.dim(`(${b.source.label}, ${b.source.importedArchive ? "imported-archive" : b.source.kind})`),
        pc.dim("→"),
        targetMarkers.join(", "),
      ].join(" "),
    );
  }
  return 0;
}

export async function list(): Promise<number> {
  return runListCli();
}
