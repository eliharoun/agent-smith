import { fileURLToPath } from "node:url";
import type { Runner } from "../../io/git";
import { defaultRunner, pullIfClean, revListCount } from "../../io/git";
import { getInstallInfoForRunningModule, type InstallInfo } from "../../io/install-type";
import { writeLauncher } from "../../io/launcher";
import { resolveWorkspacePath } from "../../io/workspace-version";
import { EXIT_OK, EXIT_PARTIAL, EXIT_RUNTIME } from "../exit-codes";
import { runDoctorCli } from "./doctor";

export interface UpdateCliOptions {
  /** When true, do precondition checks + `git fetch` only, no mutations. */
  dryRun: boolean;
  /** Defaults to console.log */
  print?: (line: string) => void;
  /**
   * For testing: override git runner. The runner is invoked with raw git
   * arg arrays and a cwd that the caller controls. Defaults to a
   * `defaultRunner(workspacePath)` constructed once the workspace is resolved.
   */
  runner?: Runner;
  /** For testing: override the bun-install step. */
  bunInstall?: (cwd: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * For testing: override the post-update doctor invocation. Defaults to
   * runDoctorCli({ offline: false, noCache: false, json: false }).
   */
  runDoctor?: (workspacePath: string) => Promise<number>;
  /**
   * For testing: override the agent-smith reinstall step that runs between
   * bun install and doctor. The default invokes the in-process install
   * command for the agent-smith bundle so its knowledge dir refreshes from
   * the just-pulled guides.
   */
  runReinstall?: (
    workspacePath: string,
    agentName: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * For testing: override the GUI bundle rebuild step that runs after
   * `bun install`. The default invokes `bun run gui:build` in the
   * workspace so `smith gui` keeps serving fresh SPA assets after pulls.
   */
  runGuiBuild?: (cwd: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * For testing: override the launcher-rewrite step that runs between
   * the agent-smith reinstall and doctor. The default invokes
   * `writeLauncher({ workspacePath })` which rewrites `~/.local/bin/smith`
   * with the bun-path-hardcoded wrapper. Tests pass a stub to keep the
   * test process's real `~/.local/bin/smith` untouched.
   */
  runWriteLauncher?: (
    workspacePath: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * For testing: override `import.meta.url` resolution. Defaults to the
   * import.meta.url of update.ts (i.e. the running source file).
   */
  importMetaUrl?: string;
  /** For testing: override install-type detection. */
  getInstallInfo?: (importMetaUrl: string) => Promise<InstallInfo>;
  /** For testing: override the package-manager global upgrade step. */
  runPackageUpgrade?: (info: InstallInfo) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** For testing: override the post-upgrade knowledge refresh (fresh smith spawn). */
  runPostUpgradeRefresh?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** For testing: override the post-upgrade doctor (fresh smith spawn). */
  runPostUpgradeDoctor?: () => Promise<number>;
  /** For testing: override the packaged dry-run query. */
  dryRunQuery?: (info: InstallInfo) => Promise<{ upToDate: boolean | null; message: string }>;
}

async function defaultBunInstall(
  cwd: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Prefer the bun on PATH; fall back to the literal "bun" if Bun.which
  // can't find it (e.g. PATH was scrubbed). Inheriting stdio so the user
  // sees install progress live is intentional — the doctor section that
  // follows is the same shape.
  const bunPath = Bun.which("bun") ?? "bun";
  const proc = Bun.spawn([bunPath, "install"], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0 ? { ok: true } : { ok: false, error: `bun install exited with code ${code}` };
}

async function defaultRunGuiBuild(
  cwd: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `smith gui` serves the static SPA from gui/web/dist/. After a `git
  // pull` brings in GUI changes, the on-disk dist is stale (or missing,
  // for users who installed before Step 5b of bin/install existed). Run
  // the build here so post-update `smith gui` always serves matching
  // assets. Inheriting stdio matches the surrounding bun-install /
  // doctor sections so the user sees vite progress live.
  const bunPath = Bun.which("bun") ?? "bun";
  const proc = Bun.spawn([bunPath, "run", "gui:build"], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0
    ? { ok: true }
    : { ok: false, error: `bun run gui:build exited with code ${code}` };
}

async function defaultRunWriteLauncher(
  workspacePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Rewrite ~/.local/bin/smith with the bun-path-hardcoded wrapper.
  // Mirrors `bin/install` Step 6's logic so users picking up this fix
  // via `smith update` get the same launcher shape as fresh installs.
  // Idempotent — same canonical paths on every run.
  const result = await writeLauncher({ workspacePath });
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error };
}

async function defaultRunReinstall(
  _workspacePath: string,
  agentName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // In-process install — same pattern as runDoctorCli (called below).
  // The install command auto-resolves paths from its own module context,
  // so workspacePath is unused here; the parameter is preserved for
  // testability and future use (e.g., explicit workspace targeting).
  try {
    const { install } = await import("./install");
    const code = await install(agentName);
    if (code === 0) {
      return { ok: true };
    }
    return { ok: false, error: `smith agent install ${agentName} exited with code ${code}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function defaultRunPackageUpgrade(
  info: InstallInfo,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = "@eliharoun/agent-smith@latest";
  let cmd: string[];
  switch (info.packageManager) {
    case "npm":
      cmd = ["npm", "install", "-g", target];
      break;
    case "bun":
      cmd = ["bun", "add", "-g", target];
      break;
    case "pnpm":
      cmd = ["pnpm", "add", "-g", target];
      break;
    default:
      // Defensive only: runPackagedUpdate already returns EXIT_RUNTIME for an
      // "unknown" manager before this default is ever reached.
      return { ok: false, error: "unknown package manager" };
  }
  const bin = Bun.which(cmd[0]!) ?? cmd[0]!;
  const proc = Bun.spawn([bin, ...cmd.slice(1)], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  return code === 0 ? { ok: true } : { ok: false, error: `${cmd[0]} exited with code ${code}` };
}

// Post-upgrade steps re-spawn a FRESH smith — the upgrade just overwrote this
// process's own module files, so in-process calls would run half-old code.
function spawnFreshSmith(args: string[]): Promise<number> {
  const smith = Bun.which("smith") ?? "smith";
  const proc = Bun.spawn([smith, ...args], { stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}

async function defaultRunPostUpgradeRefresh(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const code = await spawnFreshSmith(["agent", "install", "agent-smith"]);
  return code === 0
    ? { ok: true }
    : { ok: false, error: `smith agent install agent-smith exited ${code}` };
}

async function defaultRunPostUpgradeDoctor(): Promise<number> {
  return spawnFreshSmith(["doctor"]);
}

async function defaultDryRunQuery(
  info: InstallInfo,
): Promise<{ upToDate: boolean | null; message: string }> {
  if (info.packageManager === "npm") {
    const bin = Bun.which("npm") ?? "npm";
    const proc = Bun.spawn([bin, "outdated", "-g", "@eliharoun/agent-smith"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const code = await proc.exited;
    // npm outdated: exit 0 = up to date, exit 1 = update available (NOT an error).
    if (code === 0) return { upToDate: true, message: "Already up to date." };
    return { upToDate: false, message: `Update available. Upgrade with: ${info.updateCommand}` };
  }
  return { upToDate: null, message: `Run \`${info.updateCommand}\` to upgrade.` };
}

async function runPackagedUpdate(
  opts: UpdateCliOptions,
  info: InstallInfo,
  print: (s: string) => void,
): Promise<number> {
  if (info.packageManager === "unknown") {
    print("Packaged install detected, but the package manager could not be determined.");
    print(`To upgrade: ${info.updateCommand}`);
    return EXIT_RUNTIME;
  }
  if (opts.dryRun) {
    const q = await (opts.dryRunQuery ?? defaultDryRunQuery)(info);
    print(q.message);
    return EXIT_OK;
  }
  print(`Upgrading via: ${info.updateCommand}`);
  const up = await (opts.runPackageUpgrade ?? defaultRunPackageUpgrade)(info);
  if (!up.ok) {
    print(`Upgrade failed: ${up.error}`);
    return EXIT_PARTIAL;
  }
  print("");
  print("Refreshing agent-smith knowledge...");
  const refresh = await (opts.runPostUpgradeRefresh ?? defaultRunPostUpgradeRefresh)();
  if (!refresh.ok) {
    print(`  (Re-run: smith agent install agent-smith — ${refresh.error})`);
  }
  print("");
  print("Running smith doctor...");
  const code = await (opts.runPostUpgradeDoctor ?? defaultRunPostUpgradeDoctor)();
  if (!refresh.ok && code === EXIT_OK) return EXIT_PARTIAL;
  return code;
}

export async function runUpdateCli(opts: UpdateCliOptions): Promise<number> {
  const print = opts.print ?? ((s: string) => console.log(s));
  const detect = opts.getInstallInfo ?? getInstallInfoForRunningModule;
  const info = await detect(import.meta.url);

  // unknown (no workspace at all): defer to the source path's existing
  // null-guard, which prints the reinstall pointer and exits.
  if (info.kind === "packaged") {
    return runPackagedUpdate(opts, info, print);
  }
  return runSourceUpdate(opts);
}

/**
 * Production wiring for `smith update`. Performs:
 *   1. Resolve workspace path from `import.meta.url`. If null (rare: the
 *      running source is not inside an agent-smith clone — e.g. unusual
 *      symlink layout, missing/malformed package.json, or a one-off
 *      `bun run src/index.ts` outside any clone), refuses with a reinstall
 *      pointer and exits 1.
 *   2. `git pull --ff-only` (refuses on dirty workspace, exit 1; network/git
 *      error exits 2).
 *   3. `bun install` to sync any updated dependencies (failure exits 2).
 *   4. Run `smith doctor` to verify the install is healthy. Doctor's exit
 *      code is propagated verbatim so drift signals reach the user.
 *
 * `--dry-run` skips steps 2-4 and instead runs `git fetch origin main` plus
 * `git rev-list --count HEAD..origin/main` to report what would change.
 */
async function runSourceUpdate(opts: UpdateCliOptions): Promise<number> {
  const print = opts.print ?? ((s: string) => console.log(s));
  const importMetaUrl = opts.importMetaUrl ?? import.meta.url;

  // Step 1: resolve workspace from import.meta.url. If null, refuse with a
  // reinstall pointer. Step numbering follows the canonical 5-step `smith
  // update` pipeline documented at guide/12-error-handling.md#update-pipeline.
  const sourcePath = fileURLToPath(importMetaUrl);
  const workspacePath = await resolveWorkspacePath(sourcePath);
  if (workspacePath === null) {
    print("Error: could not resolve agent-smith workspace; please reinstall.");
    print("");
    print("This usually means the running code is not located inside an agent-smith clone.");
    print(
      "To reinstall, run: gh repo clone eliharoun/agent-smith ~/.agent-smith && bash ~/.agent-smith/bin/install",
    );
    return EXIT_RUNTIME;
  }

  const runner = opts.runner ?? defaultRunner(workspacePath);
  const bunInstall = opts.bunInstall ?? defaultBunInstall;
  const runGuiBuild = opts.runGuiBuild ?? defaultRunGuiBuild;
  const runReinstall = opts.runReinstall ?? defaultRunReinstall;
  const runWriteLauncher = opts.runWriteLauncher ?? defaultRunWriteLauncher;
  // The cwd parameter is intentionally unused: runDoctorCli self-resolves the
  // workspace from doctor.ts's import.meta.url. Threading cwd through would
  // require a second injection seam in doctor.ts; the asymmetry is documented
  // here so a future refactor doesn't "fix" it without context.
  const runDoctor =
    opts.runDoctor ??
    ((_cwd: string) => runDoctorCli({ offline: false, noCache: false, json: false }));

  if (opts.dryRun) {
    const fetched = await runner(["fetch", "origin", "main"]);
    if (fetched.code !== 0) {
      print(`git fetch failed: ${fetched.stderr.trim() || "unknown error"}`);
      return EXIT_PARTIAL;
    }
    const countRes = await revListCount(workspacePath, "HEAD..origin/main", { runner });
    if (!countRes.ok) {
      print("Could not determine commit count; smith update would still attempt to pull.");
    } else if (countRes.value === 0) {
      print("Already up to date with origin/main.");
    } else {
      print(
        `smith update would pull ${countRes.value} commit(s) from origin/main, then run \`bun install\` and \`smith doctor\`.`,
      );
    }
    return EXIT_OK;
  }

  // --- Real update path ---

  // Step 2: pull. pullIfClean returns a discriminated union; switch on status.
  const pull = await pullIfClean(workspacePath, { runner });
  if (pull.status === "dirty") {
    print("Refusing to update: workspace has uncommitted changes.");
    print("");
    // `pullIfClean` only returns 'dirty' when porcelain has at least one
    // entry (see the dirty-detection branch in `pullIfClean`), so no
    // length guard is needed here.
    print(pull.porcelain.trimEnd());
    return EXIT_RUNTIME;
  }
  if (pull.status === "error") {
    print(`Update failed: ${pull.message}.`);
    return EXIT_PARTIAL;
  }
  print("Pulled latest from origin/main.");

  // Step 3: bun install.
  print("");
  const installResult = await bunInstall(workspacePath);
  if (!installResult.ok) {
    print(`bun install failed: ${installResult.error}`);
    return EXIT_PARTIAL;
  }
  print("Dependencies up to date.");

  // Step 3a: rewrite ~/.local/bin/smith launcher.
  // The launcher used to be a symlink to src/index.ts whose shebang is
  // #!/usr/bin/env bun. That fails under stripped-PATH spawn contexts
  // (Spotlight/dock launches, MCP clients spawning the smith MCP
  // server, cron, launchd). Replace with a wrapper that hardcodes bun's
  // absolute path. Idempotent — same canonical paths on every run.
  // Warn-and-continue on failure: doctor still reports drift, the user
  // can re-run `bash bin/install` manually.
  print("");
  print("Refreshing smith launcher...");
  const launcherResult = await runWriteLauncher(workspacePath);
  if (!launcherResult.ok) {
    print(`Launcher refresh failed: ${launcherResult.error}`);
    print("  (Other update steps continue. Retry: bash bin/install)");
  } else {
    print("Launcher refreshed.");
  }

  // Step 3b: rebuild GUI bundle.
  // gui/web/dist/ is gitignored; after a pull that brings in GUI changes
  // (or a pull on a clone whose dist was never built), `smith gui` would
  // serve stale or missing assets. Rebuild here so post-update users see
  // a GUI that matches the just-pulled source. Warn-and-continue: a
  // build failure shouldn't block doctor/reinstall — the CLI still
  // works and the user can retry `bun run gui:build` manually.
  print("");
  print("Rebuilding GUI bundle...");
  const guiBuildResult = await runGuiBuild(workspacePath);
  if (!guiBuildResult.ok) {
    print(`GUI build failed: ${guiBuildResult.error}`);
    print("  (Other update steps continue. Retry: bun run gui:build)");
  } else {
    print("GUI bundle rebuilt.");
  }

  // Step 4: refresh agent-smith's own knowledge dir.
  // The bundle declares `../../guide` as a knowledge source; re-installing
  // it after a successful pull picks up any guide updates so the running
  // agent stays in sync with the docs that ship in the same commit.
  print("");
  print("Refreshing agent-smith knowledge...");
  const reinstallResult = await runReinstall(workspacePath, "agent-smith");
  if (!reinstallResult.ok) {
    print(`agent-smith reinstall failed: ${reinstallResult.error}`);
    print("  (Other update steps succeeded. Re-run: smith agent install agent-smith)");
    // Continue to doctor — partial-success-after-success is the existing
    // pattern and we want doctor to run regardless so drift signals reach
    // the user even when reinstall failed.
  }

  // Step 5: doctor. Propagate its exit code so the user sees drift signals.
  print("");
  print("Running smith doctor...");
  const doctorCode = await runDoctor(workspacePath);

  // If launcher rewrite, reinstall, or GUI build failed but doctor passed,
  // surface the partial. Doctor drift (1) or network (2) take precedence —
  // they're more actionable than the soft-fails above.
  if ((!launcherResult.ok || !reinstallResult.ok || !guiBuildResult.ok) && doctorCode === EXIT_OK) {
    return EXIT_PARTIAL;
  }
  return doctorCode;
}
