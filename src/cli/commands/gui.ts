import { randomBytes } from "node:crypto";
import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import packageJson from "../../../package.json" with { type: "json" };
import type { InstallInfo } from "../../io/install-type";

export interface GuiArgs {
  port: number;
  bind: string;
  open: boolean;
}

export function buildGuiArgs(input: Partial<GuiArgs>): GuiArgs {
  return {
    port: input.port ?? 7777,
    bind: input.bind ?? "127.0.0.1",
    open: input.open ?? true,
  };
}

export function generateToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Walk `srcRoot` and return the newest mtime in ms (0 if dir missing/empty).
 * Skips node_modules and dotfile-prefixed entries — mirrors gui-server's
 * `newestMtimeUnder` helper in static.ts. Kept local (not extracted) until a
 * third caller appears, per Task 3 design decisions.
 */
function newestMtimeUnder(root: string): number {
  let max = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const m = statSync(full).mtimeMs;
          if (m > max) max = m;
        } catch {
          // unreadable file — skip
        }
      }
    }
  }
  return max;
}

export interface MaybeRebuildOptions {
  repoRoot: string;
  /** Injectable build runner so tests can avoid spawning `bun run gui:build`. */
  runBuild?: (cwd: string) => Promise<void>;
  /** Logger for the "rebuilding..." notice; defaults to stderr. */
  log?: (msg: string) => void;
}

/**
 * Pre-flight a `bun run gui:build` when `gui/web/dist/` is older than the
 * newest file under `gui/web/src/`. Covers users who pull updates via raw
 * `git pull` (rather than `smith update`) and would otherwise hit the
 * fail-fast guard in gui-server's `assertBundleFresh`.
 *
 * Skipped when:
 *   - `gui/web/src/` is absent (packaged install — dist is shipped).
 *   - `SMITH_GUI_NO_AUTOBUILD=1` (escape hatch for power users).
 *
 * `assertBundleFresh` in gui-server stays as defense-in-depth in case the
 * server library is booted without going through this CLI command.
 */
export async function maybeRebuildGuiBundle(opts: MaybeRebuildOptions): Promise<void> {
  const { repoRoot } = opts;
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const runBuild = opts.runBuild ?? defaultRunGuiBuild;

  const distRoot = join(repoRoot, "gui", "web", "dist");
  const srcRoot = join(repoRoot, "gui", "web", "src");

  // Packaged install: only `dist/` is shipped — nothing to compare against.
  let srcExists = false;
  try {
    srcExists = statSync(srcRoot).isDirectory();
  } catch {
    return;
  }
  if (!srcExists) return;

  if (process.env.SMITH_GUI_NO_AUTOBUILD === "1") {
    log("smith gui: SMITH_GUI_NO_AUTOBUILD=1 — skipping bundle freshness pre-flight");
    return;
  }

  let distMtime = 0;
  try {
    distMtime = statSync(join(distRoot, "index.html")).mtimeMs;
  } catch {
    distMtime = 0;
  }
  const newestSrcMtime = newestMtimeUnder(srcRoot);

  if (distMtime !== 0 && newestSrcMtime <= distMtime) {
    return; // fresh
  }

  log("Rebuilding GUI bundle (one-time, ~30s)...");
  try {
    await runBuild(repoRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `GUI bundle rebuild failed (${detail}). Run \`bun run gui:build\` manually from ${repoRoot}.`,
    );
  }
}

async function defaultRunGuiBuild(cwd: string): Promise<void> {
  // Mirrors the spawn pattern in src/cli/commands/update.ts:defaultRunGuiBuild
  // — inherited stdio so the user sees vite progress live.
  const bunPath = Bun.which("bun") ?? "bun";
  const proc = Bun.spawn([bunPath, "run", "gui:build"], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`bun run gui:build exited with code ${code}`);
  }
}

/**
 * Resolve the agent-smith repo root from this module's location.
 * `src/cli/commands/gui.ts` → repo root is three `..` up.
 */
function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), "..", "..", "..");
}

/** True when the prebuilt SPA bundle is present — works for both install modes. */
export function guiBundlePresent(repoRoot: string): boolean {
  return existsSync(join(repoRoot, "gui", "web", "dist", "index.html"));
}

/**
 * Build the "GUI bundle missing" error message, suggesting the upgrade command
 * appropriate to how smith was installed (npm/bun/pnpm). Detection is injectable
 * for tests; production uses the install-type detector. Falls back to a static
 * npm command if detection fails.
 */
export async function missingBundleMessage(
  binPath: string,
  detect?: (url: string) => Promise<InstallInfo>,
): Promise<string> {
  const { getInstallInfoForRunningModule } = await import("../../io/install-type");
  const detectFn = detect ?? getInstallInfoForRunningModule;
  let cmd = "npm i -g @eliharoun/agent-smith";
  try {
    const info = await detectFn(import.meta.url);
    if (info.updateCommand) cmd = info.updateCommand;
  } catch {
    /* fall back to static cmd */
  }
  return (
    "agent-smith: GUI bundle not found at " +
    binPath +
    "\n  - packaged install: reinstall with `" +
    cmd +
    "`." +
    "\n  - source install: run `bun run gui:build` from the repo root."
  );
}

export function createGuiCommand(): Command {
  return new Command("gui")
    .description("Launch the smith browser GUI")
    .option("--port <n>", "port to bind (default 7777, auto-increments)", (v) => Number(v))
    .option("--bind <addr>", "address to bind (default 127.0.0.1)")
    .option("--no-open", "do not open browser automatically")
    .action(async (opts: { port?: number; bind?: string; open?: boolean }) => {
      const args = buildGuiArgs(opts);
      // SMITH_GUI_DEV_TOKEN is a test-only env so Playwright E2E can use a known
      // token without scraping the random one. Never set this in release builds;
      // Task 35 adds a CI grep guard that fails if this env name appears outside
      // CLI entry and e2e/test code.
      const token = process.env.SMITH_GUI_DEV_TOKEN ?? generateToken();

      const repoRoot = resolveRepoRoot();

      // Pre-flight: rebuild a stale `gui/web/dist/` for SOURCE installs before
      // importing the server (no-ops in packaged installs — gui/web/src absent).
      await maybeRebuildGuiBundle({ repoRoot });

      // Pre-flight: the GUI cannot run without the built SPA. In packaged
      // installs `prepack` always ships it; this guard turns a missing/empty
      // bundle into a friendly message instead of a raw assertBundleFresh throw.
      if (!guiBundlePresent(repoRoot)) {
        console.error(
          await missingBundleMessage(join(repoRoot, "gui", "web", "dist", "index.html")),
        );
        process.exit(1);
      }

      // dynamic import keeps the GUI server out of CLI startup cost
      const { startGuiServer } = await import("../../../gui/server/src/index");
      const started = await startGuiServer({
        port: args.port,
        bind: args.bind,
        token,
        smithVersion: packageJson.version,
        staticRoot: join(repoRoot, "gui", "web", "dist"),
      });
      console.log(`smith gui ready at ${started.url}`);
      if (args.open) {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        Bun.spawn([opener, started.url], { stdout: "ignore", stderr: "ignore" });
      }
      // keep process alive until SIGINT
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          started.stop().finally(resolve);
        });
      });
    });
}
