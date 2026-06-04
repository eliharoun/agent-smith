/**
 * Doctor section that flags bundles whose lazy URL sources can't be fetched
 * at agent runtime. A lazy URL is fetched on-demand by the agent (not
 * materialized at install time), so the agent needs SOME runtime fetch
 * capability — either:
 *
 *   - a built-in fetch tool on at least one of its targets (Claude Code's
 *     `WebFetch`, Kiro/OpenCode equivalents), OR
 *   - an explicit `via: { server, tool }` routing to an installed MCP
 *     server that exposes a fetch-style tool.
 *
 * Severity:
 *   - `error`   — no via and no target with a built-in fetch tool. The
 *                 agent literally cannot reach the URL.
 *   - `warning` — via routes through an MCP server that isn't currently
 *                 configured on any platform (overlaps with `mcp-deps`,
 *                 but flagged here too because lazy fetch is the only
 *                 caller of that server).
 *
 * Pure-by-DI: callers inject `readAvailable` (the union of platform MCP
 * configs) and `bundles` (loaded bundle configs); this module never reads
 * `~/.claude.json` or the registry directly. The CLI surface
 * (`src/cli/commands/doctor.ts`) builds those inputs from the same
 * `loadAllBundles` result the rest of the doctor uses.
 */
import type { AvailableMap } from "../../io/mcp-config-readers";
import type { Target } from "../types";
import type { KnowledgeSource } from "../knowledge/types";
import { isLazyUrlSource } from "../knowledge/lazy-url";

/**
 * Targets whose tool map exposes a built-in HTTP fetch tool the agent can
 * call at runtime. Sourced from `data/<target>-tool-map.json` — keep in
 * sync if a target adds/removes its fetch tool. Codex has no `webfetch`
 * tool mapped today, so a bundle that targets only Codex with a lazy URL
 * source MUST configure `via:` routing.
 */
const TARGETS_WITH_FETCH: ReadonlySet<Target> = new Set<Target>([
  "claude-code",
  "kiro",
  "opencode",
]);

export interface LazyFetchBundle {
  name: string;
  targets: Target[];
  sources: KnowledgeSource[];
  mcp?: { required?: string[]; peer?: string[] };
}

export interface LazyFetchFinding {
  agent: string;
  sourceId: string;
  severity: "error" | "warning";
  message: string;
}

export interface CheckLazyFetchOpts {
  bundles: LazyFetchBundle[];
  readAvailable: () => Promise<AvailableMap>;
}

/**
 * Walk every bundle's lazy URL sources and emit one finding per source
 * that can't be fetched at runtime. Sources that aren't lazy URLs are
 * skipped silently — they're materialized at install time and don't need
 * a runtime fetch path.
 */
export async function checkLazyFetch(opts: CheckLazyFetchOpts): Promise<LazyFetchFinding[]> {
  const findings: LazyFetchFinding[] = [];
  const available = await opts.readAvailable();
  for (const bundle of opts.bundles) {
    for (const src of bundle.sources) {
      if (!isLazyUrlSource(src)) continue;
      const via = (src as { via?: { server: string; tool: string } }).via;
      if (via) {
        // via routing — server must be configured on at least one platform.
        if (!(via.server in available)) {
          findings.push({
            agent: bundle.name,
            sourceId: src.id,
            severity: "warning",
            message: `lazy source ${src.id} routes through ${via.server} but ${via.server} is not installed`,
          });
        }
        // If via is set, target compatibility is moot — the agent calls the
        // MCP tool, not a built-in WebFetch.
        continue;
      }
      // No via — the agent must have a built-in fetch tool on at least one
      // of its declared targets. We treat "any target works" as sufficient
      // because the runtime picks one platform per session.
      const targetsWithFetch = bundle.targets.filter((t) => TARGETS_WITH_FETCH.has(t));
      if (targetsWithFetch.length === 0) {
        findings.push({
          agent: bundle.name,
          sourceId: src.id,
          severity: "error",
          message: `lazy source ${src.id} has no via: routing and no target supports a runtime fetch tool (targets: ${bundle.targets.join(", ")})`,
        });
      }
    }
  }
  return findings;
}
