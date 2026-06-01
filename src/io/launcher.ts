import { chmod, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Smith launcher wrapper writer.
 *
 * The launcher at `~/.local/bin/smith` used to be a symlink to
 * `<repo>/src/index.ts` whose shebang is `#!/usr/bin/env bun`. That fails in
 * stripped-PATH spawn contexts: Spotlight/dock launches, MCP clients (Claude
 * Code, Kiro, OpenCode, Codex) spawning the smith MCP server, cron, and
 * launchd. `env` cannot find `bun` in those contexts and the spawn dies with
 * "env: bun: No such file or directory".
 *
 * Replacement: a tiny bash wrapper that hardcodes bun's absolute path
 * captured at write time. This module owns the wrapper-write side; `bin/install`
 * has a parallel implementation in shell. They produce byte-identical output
 * so update-mode detection in `bin/install` continues to recognize a
 * launcher written by either path.
 *
 * Re-rewritten on every install / update so a moved bun (version bump, path
 * change) is picked up at the next install.
 */

export interface WriteLauncherOptions {
  /** Absolute path to the smith repo root (the dir containing `src/index.ts`). */
  workspacePath: string;
  /**
   * Override for the launcher path. Default `~/.local/bin/smith`.
   * Tests pass a tmpdir-based path; production uses the default.
   */
  launcherPath?: string;
  /**
   * Override for bun path resolution. Default tries `Bun.which("bun")`
   * first, then `process.execPath` (the running bun if smith was launched
   * via the bun shebang).
   */
  resolveBun?: () => string | null;
}

export type WriteLauncherResult =
  | { ok: true; launcherPath: string; bunPath: string; entryPath: string }
  | { ok: false; error: string };

function defaultLauncherPath(): string {
  return join(homedir(), ".local", "bin", "smith");
}

function defaultResolveBun(): string | null {
  // Bun.which is the canonical lookup in a Bun process. Fall back to
  // process.execPath when smith was invoked via the bun shebang — in that
  // case the running interpreter IS bun and execPath is its absolute path.
  const fromWhich =
    typeof Bun !== "undefined" && typeof Bun.which === "function"
      ? Bun.which("bun")
      : null;
  if (fromWhich && fromWhich.startsWith("/")) return fromWhich;
  if (process.execPath && process.execPath.endsWith("/bun")) return process.execPath;
  return null;
}

/**
 * The wrapper body. Exported so tests can assert byte equality and
 * `bin/install` shell tests can recognize the same shape.
 *
 * Uses the same heredoc layout as `bin/install` Step 6 (kept in sync).
 * Trailing newline matches POSIX-text convention.
 */
export function buildLauncherBody(bunPath: string, entryPath: string): string {
  return `#!/usr/bin/env bash
# agent-smith launcher — hardcodes bun's path for hermetic spawn contexts.
#
# GUI apps launched from Spotlight/dock/Finder, MCP clients (Claude Code,
# Kiro, OpenCode, Codex), cron, and launchd all spawn with a stripped PATH.
# A '#!/usr/bin/env bun' shebang fails because 'env' can't find 'bun' in
# those contexts. This wrapper captures bun's path at install time and
# exec's smith's entry script directly.
#
# Re-rewritten on every \`bash bin/install\` and \`smith update\` run.
exec "${bunPath}" "${entryPath}" "$@"
`;
}

/**
 * Write the smith launcher wrapper to disk. Idempotent: writes byte-
 * identical content on repeated calls (bun and entry paths are
 * canonicalized via `realpath`).
 *
 * Removes any pre-existing symlink before writing — `writeFile` would
 * follow the symlink and write through to its target, which is wrong
 * (the target is `<repo>/src/index.ts` and we'd corrupt it).
 */
export async function writeLauncher(
  options: WriteLauncherOptions,
): Promise<WriteLauncherResult> {
  const launcherPath = options.launcherPath ?? defaultLauncherPath();
  const resolveBun = options.resolveBun ?? defaultResolveBun;

  const bunRaw = resolveBun();
  if (!bunRaw || !bunRaw.startsWith("/")) {
    return {
      ok: false,
      error: `could not resolve absolute path to bun (got: ${
        bunRaw ?? "<null>"
      }). Install bun from https://bun.sh.`,
    };
  }

  const entryRaw = join(options.workspacePath, "src", "index.ts");

  // Canonicalize both paths so the wrapper embeds the same form across
  // platforms / symlink layouts. Mirrors bin/install Step 6's
  // `resolve_path` calls — both code paths must agree on the embedded
  // form so update-mode detection in bin/install (which greps the
  // launcher for the canonical entry path) continues to work.
  let bunPath: string;
  let entryPath: string;
  try {
    bunPath = await realpath(bunRaw);
  } catch {
    bunPath = bunRaw;
  }
  try {
    entryPath = await realpath(entryRaw);
  } catch (err) {
    return {
      ok: false,
      error: `entry script not found at ${entryRaw}: ${(err as Error).message}`,
    };
  }

  await mkdir(dirname(launcherPath), { recursive: true });

  // Remove a pre-existing symlink so writeFile creates a fresh regular
  // file. `rm` with force ignores ENOENT; lstat would be needed to
  // detect symlink-vs-regular reliably, but since we always want to
  // replace the file regardless of its prior shape, unconditional rm
  // is correct.
  await rm(launcherPath, { force: true });

  const body = buildLauncherBody(bunPath, entryPath);
  await writeFile(launcherPath, body, "utf8");
  await chmod(launcherPath, 0o755);

  return { ok: true, launcherPath, bunPath, entryPath };
}
