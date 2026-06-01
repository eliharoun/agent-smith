import { execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { SmithError } from "../../../../src/core/smith-error";

/**
 * Resolve the user's home directory, honoring a runtime-mutated `HOME`
 * over `os.homedir()`'s startup-cached value. Tests rely on overriding
 * `process.env.HOME` to redirect the `~/.local/bin/smith` probe.
 */
function effectiveHome(): string {
  return process.env.HOME ?? homedir();
}

/**
 * Resolve an absolute path to the running `smith` executable.
 *
 * GUI apps launched from Spotlight, dock, Finder (or any non-shell context)
 * don't inherit the user's PATH, so writing a bare `"smith"` into MCP configs
 * fails to spawn at session time — the agent silently never connects to the
 * knowledge MCP server. Always write an absolute path.
 *
 * Resolution priority (first that resolves wins):
 *
 *   1. `process.argv[1]` realpath — when the GUI is launched via `smith gui`,
 *      argv[1] IS smith's entry script. This is the most reliable: same
 *      install that wrote the config has the same path. Accepts argv[1]
 *      whose basename is `smith` directly, or whose realpath has a sibling
 *      smith executable (e.g. dev-mode `smith` shim launching `index.ts`).
 *   2. `~/.local/bin/smith` — installer's default symlink location.
 *   3. `which smith` — last-resort PATH lookup.
 *
 * Throws SmithError("not-found", ...) when none resolve. Callers in the
 * toggle path surface this as HTTP 500 with a clear "couldn't resolve smith
 * path; reinstall smith and retry" message — better to fail the toggle than
 * silently write a broken config.
 *
 * Result is cached for the process lifetime: smith's path doesn't change
 * within one GUI session, and re-stat'ing for every wiring call is wasteful.
 */
let cached: string | undefined;

export function resolveSmithPath(): string {
  if (cached) return cached;
  // Test/packaging escape hatch — same convention as smith-binary.ts.
  // Validates the override is an executable file so a bogus value still
  // surfaces as not-found instead of writing a broken config.
  const override = process.env.SMITH_BIN;
  if (override) {
    const validated = validateExecutable(override);
    if (validated) {
      cached = validated;
      return cached;
    }
  }
  const candidate =
    fromArgv1() ?? fromHomeLocalBin(effectiveHome()) ?? fromWhich();
  if (!candidate) {
    throw new SmithError({
      code: "not-found",
      what: "smith executable",
      identifier: "smith",
      suggestedCommand: "reinstall smith from https://github.com/anthropics/agent-smith",
    });
  }
  cached = candidate;
  return cached;
}

/**
 * Soft variant for non-toggle code paths that benefit from a signal but
 * shouldn't crash if smith isn't installed (e.g. dev-mode test runs that
 * never actually spawn the MCP server).
 */
export function resolveSmithPathOrUndefined(): string | undefined {
  try {
    return resolveSmithPath();
  } catch {
    return undefined;
  }
}

/** Test-only — the cache lives at module scope across the bun:test run. */
export function __resetSmithPathCacheForTests(): void {
  cached = undefined;
}

function fromArgv1(): string | undefined {
  const argv1 = process.argv[1];
  if (!argv1) return undefined;
  // Direct: argv[1] basename is `smith`.
  const direct = validateExecutable(argv1);
  if (direct && basename(direct) === "smith") return direct;
  // Dev-mode: argv[1] could be `index.ts` under a smith repo. Try the
  // sibling `~/.local/bin/smith` symlink — handled by the next priority
  // step. We don't probe further here.
  return undefined;
}

function fromHomeLocalBin(home: string): string | undefined {
  return validateExecutable(join(home, ".local", "bin", "smith"));
}

function fromWhich(): string | undefined {
  let out: string;
  try {
    out = execFileSync("which", ["smith"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // Explicit env so callers (and tests) that mutate process.env.PATH
      // see their change reflected in the child. Bun's execFileSync uses
      // the parent process's snapshotted env unless env is passed in.
      env: process.env,
    });
  } catch {
    // Either `which` itself missing (ENOENT) or smith not on PATH (non-zero
    // exit). Either way: fall through.
    return undefined;
  }
  const path = out.trim().split("\n")[0]?.trim();
  if (!path) return undefined;
  return validateExecutable(path);
}

/**
 * Returns the realpath of `path` when it points to an executable file the
 * current process can run. Returns undefined for any failure mode (missing,
 * not a file, not executable, broken symlink). Stays synchronous because
 * the resolver is called from sync write paths.
 */
function validateExecutable(path: string): string | undefined {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return undefined;
  }
  try {
    const st = statSync(real);
    if (!st.isFile()) return undefined;
  } catch {
    return undefined;
  }
  try {
    accessSync(real, fsConstants.X_OK);
  } catch {
    return undefined;
  }
  return real;
}
