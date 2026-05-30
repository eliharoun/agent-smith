/**
 * GUI-side mirror of the CLI's synthetic "agent-smith-self" source. The
 * CLI's `resolveAllSources` (in src/io/registry.ts) prepends a Source
 * pointing at the running CLI's bundled `agents/` directory, so commands
 * like `smith agent list` find the bundled `agent-smith` companion
 * regardless of registry contents. Without this mirror, the GUI's
 * /api/agents endpoint is missing those bundles and reports 0 agents
 * even when the CLI shows them.
 *
 * We re-implement the detector locally instead of importing the CLI's
 * helper because gui/server's tsconfig has rootDir:"src" — pulling code
 * from ../../../src/ would either need a cross-tree dynamic import or a
 * tsconfig change that would expand build context across the whole repo.
 * The detector is small (~30 lines) and well-bounded, so a local copy is
 * the cleanest fit.
 */

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable label used by the synthetic source. Must match SELF_SOURCE_LABEL in src/io/registry.ts. */
export const SELF_SOURCE_LABEL = "agent-smith-self";

/** Walked up to find package.json with `name: "agent-smith"`. */
const WORKSPACE_PKG_NAMES = new Set(["agent-smith"]);

export interface SelfSource {
  kind: "registered";
  rootPath: string;
  label: typeof SELF_SOURCE_LABEL;
}

export interface ResolveSelfSourceOpts {
  /**
   * Pre-resolved workspace root (the directory containing package.json).
   * When omitted, walks up from this file's directory looking for
   * `package.json` whose `name` field is `agent-smith`. Tests inject a
   * fixture root.
   */
  workspaceRoot?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` looking for a package.json whose `name` field
 * identifies the agent-smith workspace. Returns the directory containing
 * that package.json, or null if none is found before the filesystem root.
 */
async function findAgentSmithWorkspace(start: string): Promise<string | null> {
  let dir = start;
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (await pathExists(pkgPath)) {
      try {
        const raw = await Bun.file(pkgPath).text();
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name && WORKSPACE_PKG_NAMES.has(pkg.name)) return dir;
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the synthetic "agent-smith-self" source. Returns null when:
 *   - the GUI server isn't running from inside an agent-smith clone,
 *   - the resolved workspace has no `agents/` dir.
 *
 * Mirrors `tryResolveSelfSource` in src/io/registry.ts.
 */
export async function resolveSelfSource(
  opts: ResolveSelfSourceOpts = {},
): Promise<SelfSource | null> {
  let workspaceRoot: string | null;
  if (opts.workspaceRoot !== undefined) {
    workspaceRoot = (await pathExists(opts.workspaceRoot)) ? opts.workspaceRoot : null;
    if (workspaceRoot !== null) {
      const pkgPath = join(workspaceRoot, "package.json");
      try {
        const raw = await Bun.file(pkgPath).text();
        const pkg = JSON.parse(raw) as { name?: string };
        if (!pkg.name || !WORKSPACE_PKG_NAMES.has(pkg.name)) return null;
      } catch {
        return null;
      }
    }
  } else {
    const startDir = dirname(fileURLToPath(import.meta.url));
    workspaceRoot = await findAgentSmithWorkspace(startDir);
  }

  if (!workspaceRoot) return null;
  const agentsDir = join(workspaceRoot, "agents");
  if (!(await pathExists(agentsDir))) return null;

  return {
    kind: "registered",
    rootPath: agentsDir,
    label: SELF_SOURCE_LABEL,
  };
}
