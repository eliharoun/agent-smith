// User-global persistence for PlatformConvention selections.
// Lives at ~/.config/agent-smith/conventions.json. Mirrors
// installed-skills.ts patterns: ENOENT-tolerant load, atomicWriteJson save.
//
// Schema:
//   { schemaVersion: 1, platformConventions: { <Target>: { default?, explicit? } } }
//
// `default` describes the auto-resolution strategy when `explicit` is absent.
// `explicit`, when present, is the exact convention ID list to use
// (bypasses `default`). Unknown convention IDs in saved prefs are silently
// ignored at resolve time — see resolveConventions in platform-conventions.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Target } from "../core/types";
import { atomicWriteJson } from "./atomic-write";
import { stateHome } from "./state-home";

const FILE_REL = ".config/agent-smith/conventions.json";
const FILE_BASENAME = "conventions.json";

export type DefaultStrategy = "accept-all" | "reject-all" | "use-defaults" | "prompt";

export interface PlatformConventionsPref {
  /**
   * Auto-resolution strategy when `explicit` is absent. `"prompt"` means
   * smith asks the user the next time they install (TTY only).
   */
  default?: DefaultStrategy;
  /**
   * Exact convention ID list. Bypasses `default` when present.
   * Unknown IDs are silently ignored at resolve time.
   */
  explicit?: string[];
}

export interface ConventionsFile {
  schemaVersion: 1;
  platformConventions: Partial<Record<Target, PlatformConventionsPref>>;
}

export interface ConventionsOpts {
  /** Test seam for the state-file home dir. */
  homeDir?: string;
}

function pathFor(opts?: ConventionsOpts): string {
  if (opts?.homeDir) return join(opts.homeDir, FILE_REL);
  return join(stateHome(), FILE_BASENAME);
}

export async function loadConventions(opts?: ConventionsOpts): Promise<ConventionsFile> {
  let raw: string;
  try {
    raw = await readFile(pathFor(opts), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, platformConventions: {} };
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as ConventionsFile;
  // Lenient on shape: malformed prefs file degrades to empty rather than
  // bricking install. Same posture as installed-agents.ts.
  if (parsed?.schemaVersion !== 1 || typeof parsed.platformConventions !== "object") {
    return { schemaVersion: 1, platformConventions: {} };
  }
  return parsed;
}

export async function saveConventions(
  file: ConventionsFile,
  opts?: ConventionsOpts,
): Promise<void> {
  await atomicWriteJson(pathFor(opts), file);
}
