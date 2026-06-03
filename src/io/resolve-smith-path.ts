import { execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { SmithError } from "../core/smith-error";

/**
 * Resolve an absolute path to the running `smith` executable.
 *
 * Used by `smith knowledge wire/unwire` (and future CLI wiring helpers) to
 * write an absolute `command` field into AI-client MCP configs. GUI clients
 * launched from Spotlight/dock/Finder don't inherit shell PATH, so a bare
 * `"smith"` would silently fail to spawn — always write an absolute path.
 *
 * Resolution priority (first that resolves wins):
 *   1. `process.env.SMITH_BIN` — explicit override (test/packaging).
 *   2. `process.argv[1]` realpath — when `smith knowledge wire` is the
 *      live entrypoint, argv[1] IS smith. Same install that wrote the
 *      config will spawn it.
 *   3. `~/.local/bin/smith` — installer's default symlink location.
 *   4. `which smith` — PATH lookup last resort.
 *
 * The GUI server has its own near-identical resolver in
 * `gui/server/src/services/resolve-smith-path.ts` (kept separate because
 * the gui workspace can't import from `src/` cleanly in test runs that
 * stub `SMITH_BIN`). Both share the four-step ladder; either entrypoint's
 * resolution order is the same.
 *
 * Throws SmithError("not-found") when none resolve. Callers should surface
 * this with a "reinstall smith" suggestion — better to fail than to silently
 * write a broken config.
 */
function effectiveHome(): string {
  return process.env.HOME ?? homedir();
}

let cached: string | undefined;

export function resolveSmithPath(): string {
  if (cached) return cached;
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

/** Test-only — module-scoped cache lives across the bun:test run. */
export function __resetSmithPathCacheForTests(): void {
  cached = undefined;
}

function fromArgv1(): string | undefined {
  const argv1 = process.argv[1];
  if (!argv1) return undefined;
  const direct = validateExecutable(argv1);
  if (direct && basename(direct) === "smith") return direct;
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
      env: process.env,
    });
  } catch {
    return undefined;
  }
  const path = out.trim().split("\n")[0]?.trim();
  if (!path) return undefined;
  return validateExecutable(path);
}

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
