/**
 * Build the per-bundle `withRefreshHooksFor` opt-in map the orchestrator
 * needs to emit Claude Code SessionStart refresh hooks into rendered agent
 * frontmatter.
 *
 * The map is populated from each bundle's persisted refresh-manifest.json
 * (under `<agentSmithHome>/refresh/<bundle.config.name>/`), which records
 * the user's prior `smith agent knowledge install` consent.
 *
 * Why only `"claude-code"`: it is the only currently-supported platform
 * whose refresh hook lives in the rendered agent's frontmatter and therefore
 * requires a pre-render opt-in to be emitted. Codex (and, in the future,
 * OpenCode) register hooks post-render in their own config files, so they
 * don't gate on this map.
 *
 * Bundles with no manifest produce no entry. Bundles whose manifest exists
 * but lists only non-claude platforms also produce no entry. Corrupt /
 * unparseable manifests propagate the underlying SmithError so the daemon's
 * existing error log path can surface them — silently dropping them would
 * resurrect exactly the fail-closed regression this helper fixes.
 */
import type { AgentBundle } from "../types";
import { readRefreshManifest } from "./refresh-manifest";
import type { PlatformId } from "../../io/platform-detect";

const CLAUDE_CODE: PlatformId = "claude-code";

export async function buildRefreshHooksMap(
  agentSmithHome: string,
  bundles: AgentBundle[],
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  for (const bundle of bundles) {
    const manifest = await readRefreshManifest(agentSmithHome, bundle.config.name);
    if (!manifest) continue;
    if (manifest.refresh_consent.platforms.includes(CLAUDE_CODE)) {
      map.set(bundle.config.name, true);
    }
  }
  return map;
}
