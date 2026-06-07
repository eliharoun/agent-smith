import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import pc from "picocolors";
import { SmithError } from "../../core/smith-error";
import type { AgentBundle, InstallPaths } from "../../core/types";
import type { KnowledgePaths } from "../../io/knowledge-paths";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import type { Registry } from "../../io/registry";
import { planUninstall, removeBundle } from "../../io/uninstaller";
import type { UninstallerDeps } from "../../io/uninstaller";
import { EXIT_OK, EXIT_RUNTIME } from "../exit-codes";
import { defaultInstallPaths, defaultKnowledgePaths } from "../install-paths";
import { findBundleOrFail, loadAllBundles, type LoadAllBundlesResult } from "../load-all";
import { readToken as defaultReadToken } from "../prompt";
import { guardProtectedAgent } from "./protected-confirm";
import { renderUninstallTable } from "../render/uninstall-table";

function isOwnedBundle(bundle: AgentBundle, configDir: string): boolean {
  if (bundle.source.kind !== "user-global") return false;
  const root = bundle.source.rootPath;
  return root === configDir || root.startsWith(configDir + sep);
}

function tildify(path: string, home: string): string {
  if (path === home) return "~";
  if (path.startsWith(home + sep)) return "~" + path.slice(home.length);
  return path;
}

export interface DestroyAgentCliOptions {
  name: string;
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  paths?: InstallPaths;
  knowledgePaths?: KnowledgePaths;
  configDir?: string;
  homeDir?: string;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  rmFile?: (path: string) => Promise<void>;
  /**
   * Recursive removal hook for the **knowledge** dir (matches
   * `UninstallerDeps.rmDir`). Forwarded into `removeBundle` for knowledge
   * cleanup. Distinct from `rmSourceDir` which removes the bundle's source
   * tree under `~/.config/agent-smith/agents/<name>/`.
   */
  rmDir?: (path: string) => Promise<void>;
  /**
   * Recursive removal hook for the bundle's **source** directory under
   * `configDir`. Renamed from the old `rmDir` to avoid colliding with the
   * uninstaller's `rmDir` for knowledge dirs.
   */
  rmSourceDir?: (path: string) => Promise<void>;
  statFile?: (path: string) => Promise<unknown>;
  readToken?: (prompt: string) => Promise<string>;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

export async function runDestroyAgentCli(opts: DestroyAgentCliOptions): Promise<number> {
  await guardProtectedAgent(opts.name, "destroy", opts.readToken);
  const paths = opts.paths ?? defaultInstallPaths();
  const knowledgePaths = opts.knowledgePaths ?? defaultKnowledgePaths();
  const home = opts.homeDir ?? homedir();
  const configDir = opts.configDir ?? join(home, ".config", "agent-smith");
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const print = opts.print ?? ((m: string) => console.log(m));

  const registry = await loadReg(canonicalRegistryPath());
  const result = await loadBundles(registry);
  const bundle = findBundleOrFail(result, opts.name);

  if (!isOwnedBundle(bundle, configDir)) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent bundle",
      reasons: [
        `Bundle "${opts.name}" is not managed by agent-smith (source rootPath is outside ${configDir}).`,
        "agent destroy only removes bundles created by 'smith agent init'.",
      ],
    });
  }

  const planDeps: UninstallerDeps = {};
  if (opts.statFile) planDeps.statFn = opts.statFile;
  const plan = await planUninstall(bundle, paths, knowledgePaths, planDeps);
  const installedTargets = plan.targets.filter((t) => t.exists);

  print(pc.bold(`Agent: ${bundle.config.name}`));
  print(`  Located at: ${tildify(bundle.bundlePath, home)}`);
  print("");
  print("  Installed in:");
  const verbExisting = opts.dryRun
    ? "→ would be uninstalled"
    : opts.force
      ? "→ will be uninstalled"
      : "→ still installed";
  for (const line of renderUninstallTable([plan], {
    verbForExisting: verbExisting,
    verbForMissing: "→ no action",
  })) {
    print(`  ${line}`);
  }
  print("");
  print("  Source files:");
  const sourceVerb = opts.dryRun ? "would be permanently removed" : "will be permanently removed";
  print(`    ${pc.yellow("⚠")} ${sourceVerb}`);

  if (opts.dryRun) {
    print("");
    print(pc.dim("DRY RUN — no changes made."));
    return EXIT_OK;
  }

  if (installedTargets.length > 0 && !opts.force) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent bundle",
      reasons: [
        `Destroying "${bundle.config.name}" while it is installed in ${installedTargets.length} target(s) (${installedTargets.map((t) => t.target).join(", ")}) would leave dangling agent definitions in those editor configs.`,
        `Run 'smith agent uninstall ${bundle.config.name}' first to remove the rendered files, then re-run destroy — or pass --force to chain both steps.`,
      ],
      suggestedCommand: `smith agent destroy ${bundle.config.name} --force`,
    });
  }

  if (!opts.yes) {
    const readToken = opts.readToken ?? defaultReadToken;
    print("");
    const answer = await readToken(`Type '${bundle.config.name}' to confirm destruction: `);
    if (answer !== bundle.config.name) {
      print(pc.dim("Aborted. No changes made."));
      return EXIT_RUNTIME;
    }
  }

  if (installedTargets.length > 0 && opts.force) {
    print("");
    print("Uninstalling rendered files...");
    const depOverrides: UninstallerDeps = {};
    if (opts.rmFile) depOverrides.rmFile = opts.rmFile;
    if (opts.rmDir) depOverrides.rmDir = opts.rmDir;
    // destroy --force chains the uninstall AND bypasses the manifest hash-
    // mismatch refusal — destroy is irrevocable by design, so any drift on
    // smith-installed files is overridden.
    depOverrides.force = true;
    if (opts.homeDir !== undefined) depOverrides.homeDir = opts.homeDir;
    const uninstallResult = await removeBundle(bundle, paths, knowledgePaths, depOverrides);
    for (const p of uninstallResult.removed) print(`  ${pc.green("✓")} uninstalled from ${tildify(p, home)}`);
    for (const p of uninstallResult.notFound) print(`  ${pc.dim("-")} not found: ${tildify(p, home)}`);
    for (const e of uninstallResult.errors) print(`  ${pc.red("✗")} failed: ${tildify(e.path, home)} (${e.message})`);
  }

  if (opts.rmSourceDir) {
    await opts.rmSourceDir(bundle.bundlePath);
  } else {
    await rm(bundle.bundlePath, { recursive: true, force: true });
  }
  print(`${pc.green("✓")} removed source dir: ${tildify(bundle.bundlePath, home)}`);

  return EXIT_OK;
}
