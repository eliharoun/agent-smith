/**
 * Permission-group → platform-tool-name expansion.
 *
 * Loads the static mapping data shipped under `data/` at module init.
 * The maps carry a `_meta` block (provenance) consumed by `smith doctor`
 * for freshness checks. The `mapping` field is the actual lookup data.
 */

import claudeCodeData from "../../data/claude-code-tool-map.json" with { type: "json" };
import codexData from "../../data/codex-tool-map.json" with { type: "json" };
import kiroData from "../../data/kiro-tool-map.json" with { type: "json" };
import type { PermissionAction, PermissionConfig } from "./types";

/** Shape of a tool-map JSON file. */
interface ToolMapFile {
  _meta: {
    lastVerifiedDate: string;
    verifiedAgainstVersion: string;
    sourceUrl: string;
    notes: string;
  };
  mapping: Record<string, readonly string[]>;
}

const claudeCodeMapFile = claudeCodeData as ToolMapFile;
const codexMapFile = codexData as ToolMapFile;
const kiroMapFile = kiroData as ToolMapFile;

/** Readonly view over a tool map. Prevents callers from mutating the singleton arrays. */
export type ToolMap = Readonly<Record<string, readonly string[]>>;

/** Permission group → claude-code tool names. */
export const CLAUDE_CODE_TOOL_MAP: ToolMap = claudeCodeMapFile.mapping;

/** Permission group → codex tool names (best-effort; see data/codex-tool-map.json _meta.notes). */
export const CODEX_TOOL_MAP: ToolMap = codexMapFile.mapping;

/** Permission group → kiro tool names (modern snake_case singletons; see data/kiro-tool-map.json _meta.notes). */
export const KIRO_TOOL_MAP: ToolMap = kiroMapFile.mapping;

/**
 * Canonical set of opencode permission groups. Used by `expandPermissionToToolList`
 * to distinguish typos ("netwerk") from legitimate cross-platform-only groups
 * ("external_directory" — real opencode group with no claude-code equivalent).
 *
 * Sources:
 *  - All keys from CLAUDE_CODE_TOOL_MAP and CODEX_TOOL_MAP (the platform tool maps).
 *  - Groups intentionally absent from the platform maps but documented as real
 *    opencode groups in the tool-map _meta.notes (lsp, external_directory,
 *    question, doom_loop). See data/claude-code-tool-map.json.
 *
 * The opencode permission schema (`config-schema.ts`) does not enumerate the
 * group names (it uses `z.record(z.string(), ...)` for forward compatibility),
 * so this set is the canonical runtime list of "known" group names.
 *
 * If new opencode permission groups are added upstream, extend this set (and,
 * where applicable, the per-platform tool maps).
 */
export const KNOWN_PERMISSION_GROUPS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(CLAUDE_CODE_TOOL_MAP),
  ...Object.keys(CODEX_TOOL_MAP),
  ...Object.keys(KIRO_TOOL_MAP),
  // Real opencode groups with no claude-code/codex equivalent — must silent-skip.
  "lsp",
  "external_directory",
  "question",
  "doom_loop",
  // Skill is a known permission group; the kiro translator handles it
  // specially via skill:// resource emission (Task 2.3) rather than the
  // standard mapping table. expandPermissionToToolList silent-skips it
  // because it's not in any platform's mapping.
  "skill",
]);

/** Result of expanding a `PermissionConfig` against a platform's tool map. */
export interface ExpandedToolList {
  allow: string[];
  ask: string[];
  deny: string[];
  warnings: string[];
}

/** Action precedence for choosing the "broadest" (most permissive) action across a pattern record. */
const ACTION_RANK: Record<PermissionAction, number> = {
  allow: 2,
  ask: 1,
  deny: 0,
};

function broadestAction(actions: [PermissionAction, ...PermissionAction[]]): PermissionAction {
  // Tuple type guarantees a first element exists, so no cast is needed.
  let best: PermissionAction = actions[0];
  for (const a of actions) {
    if (ACTION_RANK[a] > ACTION_RANK[best]) {
      best = a;
    }
  }
  return best;
}

/**
 * Expand a structured `PermissionConfig` into per-action lists of platform tool names.
 *
 * Behavior:
 *  - String action value: look up `map[group]` and push each tool into the matching
 *    bucket. If the group is absent from the map, no-op silently (the group simply
 *    doesn't apply to this platform).
 *  - Per-pattern record value: emit a warning that pattern-level rules aren't supported
 *    on this platform, then treat the broadest action across the record as the
 *    group-level action and emit accordingly. The warning fires regardless of whether
 *    the group is in the map — the user explicitly asked for pattern semantics this
 *    platform can't honor, so they should know even if no tools end up emitted.
 *
 * Output buckets are deduped and sorted alphabetically (deterministic output).
 * Warnings preserve insertion order and are not deduped.
 */
export function expandPermissionToToolList(
  permission: PermissionConfig,
  map: ToolMap,
): ExpandedToolList {
  const buckets: Record<PermissionAction, Set<string>> = {
    allow: new Set(),
    ask: new Set(),
    deny: new Set(),
  };
  const warnings: string[] = [];

  for (const [group, value] of Object.entries(permission)) {
    let action: PermissionAction;

    if (typeof value === "string") {
      action = value;
    } else {
      // Object form: pattern → action record. Always warn (informational about
      // platform limitation), then collapse to the broadest action.
      const actions = Object.values(value);
      if (actions.length === 0) {
        // Empty pattern record — nothing to collapse. Warn and skip emission so we
        // don't crash on `broadestAction([])` and don't silently drop user intent.
        warnings.push(`Pattern-based permissions for group '${group}' has no patterns; skipping`);
        continue;
      }
      const nonEmpty = actions as [PermissionAction, ...PermissionAction[]];
      const broadest = broadestAction(nonEmpty);
      warnings.push(
        `Pattern-based permissions for group '${group}' are not supported on this platform; using broadest action '${broadest}'`,
      );
      action = broadest;
    }

    const tools = map[group];
    if (tools === undefined) {
      // Two cases:
      //  1. KNOWN_PERMISSION_GROUPS.has(group): legitimate opencode group with no
      //     equivalent on this platform (e.g. external_directory on claude-code).
      //     Silent skip — the user's intent is preserved on platforms that do
      //     map the group, and this platform simply can't honor it.
      //  2. Otherwise: the group name isn't recognized anywhere. Almost certainly
      //     a typo (e.g. "netwerk" for "webfetch"). Warn so the user notices,
      //     and surface the supported list as a hint.
      if (!KNOWN_PERMISSION_GROUPS.has(group)) {
        const supported = Array.from(KNOWN_PERMISSION_GROUPS).sort().join(", ");
        warnings.push(
          `unknown permission group '${group}' — typo? supported groups: ${supported}`,
        );
      }
      continue;
    }
    for (const tool of tools) {
      buckets[action].add(tool);
    }
  }

  return {
    allow: Array.from(buckets.allow).sort(),
    ask: Array.from(buckets.ask).sort(),
    deny: Array.from(buckets.deny).sort(),
    warnings,
  };
}
