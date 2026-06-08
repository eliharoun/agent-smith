import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Platform } from "../../../shared/src/index";

/**
 * Mirror of `defaultAgentSmithHome()` from `src/cli/install-paths.ts`.
 * Returns `$XDG_CONFIG_HOME/agent-smith` (empty-as-unset XDG semantics)
 * or `~/.config/agent-smith` when unset. Inlined (not imported from
 * `src/io/state-home.ts`) because the gui/server package cannot cleanly
 * import across the package boundary; same pattern as `gui/server/src/app.ts`.
 */
export function defaultAgentSmithHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".config", "agent-smith");
}

/**
 * Read the platforms array from
 * `<agentSmithHome>/refresh/<agent>/refresh-manifest.json`. Returns `[]` when
 * the manifest is absent (ENOENT). Surfaces other I/O errors. Defensively
 * narrows the platforms array to known Platform values.
 *
 * The path lives at the sibling `refresh/` root (NOT under `agents/`)
 * since the writer in `src/core/knowledge/refresh-manifest.ts` was moved
 * there to avoid creating phantom bundle dirs.
 */
export async function readRefreshManifestPlatforms(
  agentSmithHome: string,
  agent: string,
): Promise<Platform[]> {
  const path = join(agentSmithHome, "refresh", agent, "refresh-manifest.json");
  try {
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw) as {
      agent?: string;
      refresh_consent?: { platforms?: unknown };
    };
    const platforms = json.refresh_consent?.platforms;
    if (!Array.isArray(platforms)) return [];
    const allowed = Platform.options as readonly string[];
    return platforms.filter((p): p is Platform => typeof p === "string" && allowed.includes(p));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
