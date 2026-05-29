import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOpenCodeModels } from "./opencode-models";

/**
 * Detect which providers the user has authenticated with OpenCode.
 *
 * Layered detection:
 *   1. Read ~/.local/share/opencode/auth.json (the canonical credentials
 *      file per OpenCode's docs). Returns its top-level keys.
 *   2. If auth.json is missing or empty, fall back to inferring providers
 *      from the cached `opencode models` output (the prefix before '/').
 *   3. If both fail, returns empty array.
 *
 * Returns provider ids as strings (NOT typed to ProviderId since users may
 * authenticate against providers smith doesn't have in its table; the
 * resolver handles unknown providers gracefully).
 */
export interface DetectAuthDeps {
  readAuthFile?: (path: string) => Promise<string>;
  getModels?: () => Promise<string[] | undefined>;
  homeDir?: string;
}

export async function detectAuthenticatedProviders(deps: DetectAuthDeps = {}): Promise<string[]> {
  const home = deps.homeDir ?? homedir();
  const authPath = join(home, ".local", "share", "opencode", "auth.json");
  const read = deps.readAuthFile ?? ((p: string) => readFile(p, "utf-8"));
  const getModels = deps.getModels ?? getOpenCodeModels;

  // 1. auth.json
  try {
    const raw = await read(authPath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const providers = Object.keys(parsed).filter((k) => k.length > 0);
    if (providers.length > 0) return providers;
  } catch {
    /* file missing, unparseable, or empty — fall through */
  }

  // 2. infer from live models output
  const live = await getModels();
  if (!live || live.length === 0) return [];
  const set = new Set<string>();
  for (const id of live) {
    const idx = id.indexOf("/");
    if (idx > 0) set.add(id.slice(0, idx));
  }
  return [...set];
}
