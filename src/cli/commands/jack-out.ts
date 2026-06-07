import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import pc from "picocolors";
import type { AgentBundle, InstallPaths } from "../../core/types";
import { type InstalledSkillsFile, loadInstalledSkills } from "../../io/installed-skills";
import type { Registry } from "../../io/registry";
import { isProtectedAgent } from "../../core/protected-bundles";
import type { KnowledgePaths } from "../../io/knowledge-paths";
import { canonicalRegistryPath, loadRegistry } from "../../io/registry";
import { runtimeStateHome } from "../../io/runtime-state-home";
import { uninstallSkill as defaultUninstallSkill } from "../../io/skill-installer";
import {
  classifyPaths,
  planUninstallPaths,
  removeBundle,
  type UninstallerDeps,
} from "../../io/uninstaller";
import { EXIT_OK, EXIT_PARTIAL, EXIT_RUNTIME } from "../exit-codes";
import { defaultInstallPaths, defaultKnowledgePaths } from "../install-paths";
import { type LoadAllBundlesResult, loadAllBundles, warnAllLoadFailures } from "../load-all";
import { readToken as defaultReadToken } from "../prompt";
import {
  type DestroyAgentCliOptions,
  runDestroyAgentCli as defaultRunDestroyAgent,
} from "./destroy-agent";

/**
 * Runtime-state-home artifacts that jack-out removes.
 *
 * NOTE: `remote/` (remote-backed catalog clones) is intentionally
 * excluded — those clones are individually managed by
 * `smith {agent,skill} unregister --purge-clone` and the registry
 * (already removed via configDir) is the bookkeeping source of truth.
 * Removing them here would surprise operators who use a shared XDG
 * state home across multiple smith installs.
 */
const RUNTIME_STATE_FILES_TO_REMOVE = [
  "daemon.pid",
  "daemon.log",
  "daemon.heartbeat.json",
  "gui-jobs.jsonl",
];
const RUNTIME_STATE_DIRS_TO_REMOVE = ["gui-jobs-output", "mcp-logs"];

export interface JackOutCliOptions {
  dryRun?: boolean;
  yes?: boolean;
  paths?: InstallPaths;
  /** Knowledge-dir paths, threaded into removeBundle for agent-smith's
   *  rendered-file cleanup. Tests override; production uses the default. */
  knowledgePaths?: KnowledgePaths;
  configDir?: string;
  /**
   * Runtime state root (~/.local/state/agent-smith/ by default). Daemon
   * files (daemon.{pid,log,heartbeat.json}) and GUI job history
   * (gui-jobs.jsonl, gui-jobs-output/) are removed from here. The
   * `remote/` subdirectory of this root is NOT touched — see comment
   * on RUNTIME_STATE_FILES_TO_REMOVE for the rationale. Tests override.
   */
  runtimeStateDir?: string;
  homeDir?: string;
  loadRegistry?: (path: string) => Promise<Registry>;
  loadAllBundles?: (registry: Registry) => Promise<LoadAllBundlesResult>;
  loadInstalledSkills?: (opts?: { homeDir?: string }) => Promise<InstalledSkillsFile>;
  uninstallSkill?: (
    name: string,
    opts?: { homeDir?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  rmFile?: (path: string) => Promise<void>;
  rmDir?: (path: string) => Promise<void>;
  statFile?: (path: string) => Promise<unknown>;
  readToken?: (prompt: string) => Promise<string>;
  print?: (msg: string) => void;
  /** The source clone to remove (e.g. ~/.agent-smith/). Defaults to
   *  `${homeDir ?? homedir()}/.agent-smith`. Tests override. */
  sourceDir?: string;
  /** The smith CLI symlink to remove (e.g. ~/.local/bin/smith). Defaults
   *  to `${homeDir ?? homedir()}/.local/bin/smith`. Tests override. */
  symlinkPath?: string;
  /** The shell rc file to edit (remove the marker block). Defaults to
   *  ~/.zshrc, ~/.bash_profile, or ~/.bashrc based on $SHELL and uname.
   *  Tests override. */
  shellRcPath?: string;
  /** For testing: read the rc file. Defaults to fs.readFile. */
  readRcFile?: (path: string) => Promise<string>;
  /** For testing: write the rc file atomically. Defaults to a temp-file +
   *  rename implementation. */
  writeRcFile?: (path: string, content: string) => Promise<void>;
  /** For testing: delegate per-bundle removal. Defaults to runDestroyAgentCli.
   *  Jack-out calls this once per owned bundle with `{ yes: true, force: true }`. */
  runDestroyAgent?: (opts: DestroyAgentCliOptions) => Promise<number>;
}

const defaultRmDir = (path: string): Promise<void> => rm(path, { recursive: true, force: true });

const defaultReadRcFile = (path: string): Promise<string> => readFile(path, "utf-8");

const defaultWriteRcFile = async (path: string, content: string): Promise<void> => {
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
};

const MARKER_OPEN = "# >>> agent-smith installer >>>";
const MARKER_CLOSE = "# <<< agent-smith installer <<<";

/** Removes the agent-smith marker block from `content`. Returns the new
 *  content, or null if no marker block was present (caller should skip the
 *  write in that case). */
export function removeMarkerBlock(content: string): string | null {
  const lines = content.split("\n");
  const openIdx = lines.findIndex((l) => l.trim() === MARKER_OPEN);
  if (openIdx === -1) return null;
  const closeIdx = lines.findIndex((l, i) => i > openIdx && l.trim() === MARKER_CLOSE);
  if (closeIdx === -1) {
    return lines.slice(0, openIdx).join("\n");
  }
  const before = lines.slice(0, openIdx);
  const after = lines.slice(closeIdx + 1);
  if (before.length > 0 && before[before.length - 1]?.trim() === "") {
    before.pop();
  }
  return [...before, ...after].join("\n");
}

function defaultShellRcPath(home: string): string {
  const shell = process.env.SHELL ?? "";
  const basename = shell.split("/").pop() ?? "bash";
  if (basename === "zsh") return join(home, ".zshrc");
  if (basename === "bash") {
    return process.platform === "darwin" ? join(home, ".bash_profile") : join(home, ".bashrc");
  }
  return join(home, ".zshrc");
}

// Ownership boundary: agent-smith only manages bundles that live inside its
// own configDir (typically ~/.config/agent-smith/agents). Externally registered
// catalogs are user-owned and must be preserved on jack-out — even if their
// source kind is "user-global".
function isOwnedBundle(bundle: AgentBundle, configDir: string): boolean {
  if (bundle.source.kind !== "user-global") return false;
  const root = bundle.source.rootPath;
  return root === configDir || root.startsWith(configDir + sep);
}

export async function runJackOutCli(opts: JackOutCliOptions): Promise<number> {
  const paths = opts.paths ?? defaultInstallPaths();
  const knowledgePaths = opts.knowledgePaths ?? defaultKnowledgePaths();
  const configDir = opts.configDir ?? join(homedir(), ".config", "agent-smith");
  const runtimeStateDir = opts.runtimeStateDir ?? runtimeStateHome();
  const homeDir = opts.homeDir;
  const loadReg = opts.loadRegistry ?? loadRegistry;
  const loadBundles = opts.loadAllBundles ?? loadAllBundles;
  const loadSkills = opts.loadInstalledSkills ?? loadInstalledSkills;
  const uninstallSkillFn = opts.uninstallSkill ?? defaultUninstallSkill;
  const readToken = opts.readToken ?? defaultReadToken;
  const rmDir = opts.rmDir ?? defaultRmDir;
  const rmFile = opts.rmFile ?? ((p: string) => rm(p, { force: false }));
  const readRcFile = opts.readRcFile ?? defaultReadRcFile;
  const writeRcFile = opts.writeRcFile ?? defaultWriteRcFile;
  const runDestroyAgent = opts.runDestroyAgent ?? defaultRunDestroyAgent;
  const print = opts.print ?? ((m: string) => console.log(m));

  const home = homeDir ?? homedir();
  const sourceDir = opts.sourceDir ?? join(home, ".agent-smith");
  const symlinkPath = opts.symlinkPath ?? join(home, ".local", "bin", "smith");
  const shellRcPath = opts.shellRcPath ?? defaultShellRcPath(home);

  const registry = await loadReg(canonicalRegistryPath());
  const loadResult = await loadBundles(registry);
  warnAllLoadFailures(loadResult.failures, print);

  // jack-out is the nuclear, confirmation-gated "remove smith entirely"
  // command: it deletes the source clone, the CLI symlink, the shell-rc
  // wiring, config, runtime state, and every rendered agent/skill. The
  // protected-bundles guards deliberately do NOT apply here — preserving
  // agent-smith while deleting smith itself would only leave orphans behind.
  //
  // Bundles split three ways for removal:
  //   - owned (source inside configDir): destroyed source-and-all via
  //     `agent destroy` below.
  //   - smith's own synthetic self-source (agent-smith): its rendered files
  //     must be removed across every platform too (its source lives in the
  //     clone, deleted separately). Routed through `removeBundle` (rendered-
  //     only) rather than `agent destroy`, which refuses non-configDir / now
  //     protected bundles.
  //   - genuine user-external catalogs: PRESERVED (the user owns them; jack-out
  //     only removes agent-smith's own footprint).
  const ownedBundles = loadResult.bundles.filter((b) => isOwnedBundle(b, configDir));
  const notOwned = loadResult.bundles.filter((b) => !isOwnedBundle(b, configDir));
  const smithRenderedBundles = notOwned.filter((b) => isProtectedAgent(b.config.name));
  const skippedBundles = notOwned.filter((b) => !isProtectedAgent(b.config.name));

  const skillsFile = await loadSkills(homeDir ? { homeDir } : undefined);
  const installedSkills = skillsFile.installed;

  // Rendered-file removal covers owned bundles (full destroy) AND smith's
  // synthetic self-source bundles (rendered-only) — both across all declared
  // platforms via planUninstallPaths.
  const ownedAgentPaths = planUninstallPaths(
    [...ownedBundles, ...smithRenderedBundles],
    paths,
  );
  const classifiedAgents = await classifyPaths(ownedAgentPaths, opts.statFile);

  const skillPaths: string[] = [];
  for (const s of installedSkills) {
    for (const p of Object.values(s.installedPaths)) {
      if (p) skillPaths.push(p);
    }
  }
  const classifiedSkills = await classifyPaths(skillPaths, opts.statFile);

  print("This will permanently remove:");
  print("");
  print(`  Installed agents (${classifiedAgents.existing.length} files):`);
  if (classifiedAgents.existing.length > 0) {
    for (const p of classifiedAgents.existing) print(`    ${p}`);
  } else {
    print(pc.dim("    (none on disk)"));
  }
  print("");
  print(
    `  Installed skills (${installedSkills.length} skills, ${classifiedSkills.existing.length} paths):`,
  );
  if (installedSkills.length > 0) {
    for (const s of installedSkills) {
      print(`    ${s.name}`);
      for (const p of Object.values(s.installedPaths)) {
        if (p) print(`      ${p}`);
      }
    }
  } else {
    print(pc.dim("    (none recorded in installed-skills.json)"));
  }
  print("");
  print("  Smith config (entire directory):");
  print(`    ${configDir}`);
  print("");
  print("  Runtime state files (daemon + GUI job history):");
  const runtimeStatePaths = [
    ...RUNTIME_STATE_FILES_TO_REMOVE.map((name) => join(runtimeStateDir, name)),
    ...RUNTIME_STATE_DIRS_TO_REMOVE.map((name) => join(runtimeStateDir, name)),
  ];
  const classifiedRuntimeState = await classifyPaths(runtimeStatePaths, opts.statFile);
  if (classifiedRuntimeState.existing.length > 0) {
    for (const p of classifiedRuntimeState.existing) print(`    ${p}`);
  } else {
    print(pc.dim(`    (none on disk under ${runtimeStateDir})`));
  }
  print(
    pc.dim(
      `    note: ${join(runtimeStateDir, "remote")}/ is NOT removed (managed via 'unregister --purge-clone')`,
    ),
  );
  print("");
  print("  Smith CLI symlink:");
  print(`    ${symlinkPath}`);
  print("");
  print("  Smith source clone (entire directory):");
  print(`    ${sourceDir}`);
  print("");
  print("  Shell PATH wiring (marker block in):");
  print(`    ${shellRcPath}`);

  if (skippedBundles.length > 0) {
    print("");
    print(pc.yellow(`  Skipped — not managed by agent-smith (${skippedBundles.length} bundles):`));
    for (const b of skippedBundles) {
      print(pc.dim(`    ${b.config.name}  [${b.source.label}]  ${b.source.rootPath}`));
    }
  }

  if (opts.dryRun) {
    print("");
    print(pc.dim("DRY RUN — no changes made."));
    return EXIT_OK;
  }

  if (!opts.yes) {
    print("");
    const answer = await readToken("Type 'jack-out' to confirm: ");
    if (answer !== "jack-out") {
      print(pc.dim("Aborted. No changes made."));
      return EXIT_RUNTIME;
    }
  }

  print("");
  print("Removing installed agents (delegating to 'agent destroy')...");
  // Note: we deliberately do NOT pass `loadRegistry` or `loadAllBundles` to
  // runDestroyAgent. agent destroy does its own registry lookup and bundle
  // resolution by name; tests inject `runDestroyAgent` directly via the seam,
  // so the production defaults inside destroy-agent are the right thing.
  const destroyFailures: string[] = [];
  for (const bundle of ownedBundles) {
    try {
      const destroyOpts: DestroyAgentCliOptions = {
        name: bundle.config.name,
        yes: true,
        force: true,
        paths,
        configDir,
      };
      if (homeDir !== undefined) destroyOpts.homeDir = homeDir;
      if (opts.rmFile !== undefined) destroyOpts.rmFile = opts.rmFile;
      if (opts.rmDir !== undefined) destroyOpts.rmDir = opts.rmDir;
      if (opts.statFile !== undefined) destroyOpts.statFile = opts.statFile;
      const code = await runDestroyAgent(destroyOpts);
      if (code !== 0) {
        destroyFailures.push(bundle.config.name);
        print(pc.red(`✗ agent destroy failed for: ${bundle.config.name} (exit code ${code})`));
      }
    } catch (err) {
      destroyFailures.push(bundle.config.name);
      const msg = (err as Error)?.message ?? String(err);
      print(pc.red(`✗ agent destroy failed for: ${bundle.config.name} (${msg})`));
    }
  }

  // Remove rendered files for smith's synthetic self-source bundles
  // (agent-smith) across every declared platform. Rendered-only: the source
  // tree lives in the clone and is removed wholesale below. `agent destroy`
  // can't be used here (it refuses non-configDir bundles, and the protected-
  // bundles guard now refuses agent-smith outright), so go straight to the
  // uninstaller's removeBundle.
  if (smithRenderedBundles.length > 0) {
    const removeDeps: UninstallerDeps = {};
    if (homeDir !== undefined) removeDeps.homeDir = homeDir;
    if (opts.rmFile !== undefined) removeDeps.rmFile = opts.rmFile;
    if (opts.rmDir !== undefined) removeDeps.rmDir = opts.rmDir;
    if (opts.statFile !== undefined) removeDeps.statFn = opts.statFile;
    for (const bundle of smithRenderedBundles) {
      try {
        const r = await removeBundle(bundle, paths, knowledgePaths, removeDeps);
        if (r.errors.length > 0) {
          destroyFailures.push(bundle.config.name);
          for (const e of r.errors) {
            print(pc.red(`✗ failed to remove ${bundle.config.name} file: ${e.path} (${e.message})`));
          }
        } else {
          print(pc.green(`✓ removed rendered files for: ${bundle.config.name}`));
        }
      } catch (err) {
        destroyFailures.push(bundle.config.name);
        const msg = (err as Error)?.message ?? String(err);
        print(pc.red(`✗ failed to remove rendered files for: ${bundle.config.name} (${msg})`));
      }
    }
  }

  print("");
  print("Removing installed skills...");
  let skillFailures = 0;
  if (installedSkills.length === 0) {
    print(pc.dim("- none recorded"));
  }
  for (const s of installedSkills) {
    try {
      const r = await uninstallSkillFn(s.name, homeDir ? { homeDir } : undefined);
      if (r.ok) {
        print(pc.green(`✓ removed skill: ${s.name}`));
      } else {
        skillFailures += 1;
        print(pc.red(`✗ failed skill: ${s.name} (${r.error ?? "unknown error"})`));
      }
    } catch (err) {
      skillFailures += 1;
      const msg = (err as Error)?.message ?? String(err);
      print(pc.red(`✗ failed skill: ${s.name} (${msg})`));
    }
  }

  print("");
  print(`Removing config: ${configDir}`);
  let configError: string | null = null;
  try {
    await rmDir(configDir);
    print(pc.green(`✓ removed: ${configDir}`));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      print(pc.dim(`- not found: ${configDir}`));
    } else {
      const msg = e?.message ?? String(err);
      configError = msg;
      print(pc.red(`✗ failed: ${configDir} (${msg})`));
    }
  }

  // Remove daemon + GUI job history from the runtime state root. Only the
  // specific files listed above — `remote/` is preserved (managed by
  // `unregister --purge-clone`). If runtimeStateDir == configDir (unusual
  // env collapse) the previous rmDir(configDir) already removed everything,
  // so each file removal here is an ENOENT no-op.
  print("");
  print(`Removing runtime state files from: ${runtimeStateDir}`);
  let runtimeStateError: string | null = null;
  for (const name of RUNTIME_STATE_FILES_TO_REMOVE) {
    const target = join(runtimeStateDir, name);
    try {
      await rmFile(target);
      print(pc.green(`✓ removed: ${target}`));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") {
        print(pc.dim(`- not found: ${target}`));
      } else {
        const msg = e?.message ?? String(err);
        runtimeStateError = runtimeStateError ?? msg;
        print(pc.red(`✗ failed: ${target} (${msg})`));
      }
    }
  }
  for (const name of RUNTIME_STATE_DIRS_TO_REMOVE) {
    const target = join(runtimeStateDir, name);
    try {
      await rmDir(target);
      print(pc.green(`✓ removed: ${target}`));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") {
        print(pc.dim(`- not found: ${target}`));
      } else {
        const msg = e?.message ?? String(err);
        runtimeStateError = runtimeStateError ?? msg;
        print(pc.red(`✗ failed: ${target} (${msg})`));
      }
    }
  }

  // Remove the symlink.
  print("");
  print(`Removing CLI symlink: ${symlinkPath}`);
  let symlinkError: string | null = null;
  try {
    await rmFile(symlinkPath);
    print(pc.green(`✓ removed: ${symlinkPath}`));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      print(pc.dim(`- not found: ${symlinkPath}`));
    } else {
      symlinkError = e?.message ?? String(err);
      print(pc.red(`✗ failed: ${symlinkPath} (${symlinkError})`));
    }
  }

  // Remove the marker block from the shell rc.
  print("");
  print(`Removing PATH wiring from: ${shellRcPath}`);
  let rcError: string | null = null;
  try {
    const content = await readRcFile(shellRcPath);
    const updated = removeMarkerBlock(content);
    if (updated === null) {
      print(pc.dim(`- PATH wiring not found in ${shellRcPath}; skipping`));
    } else {
      await writeRcFile(shellRcPath, updated);
      print(pc.green(`✓ removed marker block from: ${shellRcPath}`));
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      print(pc.dim(`- PATH wiring not found in ${shellRcPath}; skipping`));
    } else {
      rcError = e?.message ?? String(err);
      print(pc.red(`✗ failed: ${shellRcPath} (${rcError})`));
    }
  }

  // Remove the source clone (LAST).
  print("");
  print(`Removing source clone: ${sourceDir}`);
  let sourceError: string | null = null;
  try {
    await rmDir(sourceDir);
    print(pc.green(`✓ removed: ${sourceDir}`));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      print(pc.dim(`- not found: ${sourceDir}`));
    } else {
      sourceError = e?.message ?? String(err);
      print(pc.red(`✗ failed: ${sourceDir} (${sourceError})`));
    }
  }

  const hasFailures =
    destroyFailures.length > 0 ||
    skillFailures > 0 ||
    configError !== null ||
    runtimeStateError !== null ||
    symlinkError !== null ||
    rcError !== null ||
    sourceError !== null;
  return hasFailures ? EXIT_PARTIAL : EXIT_OK;
}
