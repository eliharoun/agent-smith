/**
 * Kiro translator: render a CanonicalConfig into the JSON shape Kiro IDE
 * and Kiro CLI consume from `~/.kiro/agents/<name>.json`.
 *
 * Differs from opencode/claude-code/codex in three ways:
 *  1. Output format is JSON, not YAML+markdown. The body lives in the
 *     `prompt` field of the JSON document, not in a markdown body below
 *     YAML frontmatter.
 *  2. Permission system has native ask semantics (the only platform).
 *     allow → push to BOTH tools[] and allowedTools[]
 *     ask   → push to tools[] only (omit from allowedTools[])
 *     deny  → omit from both (positive allowlist)
 *  3. permission.skill drives an extra `skill://` URI emission into
 *     `resources[]` rather than going through the tool map. The skill
 *     URI scheme is documented at kiro.dev but isn't in the canonical
 *     schema (see data/kiro.agent-v1.schema.meta.json knownDivergences).
 *
 * Strict-allowlist field policy: the canonical schema has
 * `additionalProperties: false`. Smith emits ONLY documented fields —
 * never `includeMcpJson`, `useLegacyMcpJson`, `mcpServers`, `keyboardShortcut`,
 * `welcomeMessage`, `toolAliases`, `toolsSettings` (per design Q4 reversal).
 */

import { KIRO_TOOL_MAP, expandPermissionToToolList } from "../permission-mapping";
import { parseRefresh } from "../knowledge/refresh-spec";
import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";

const SCHEMA_URL =
  "https://raw.githubusercontent.com/aws/amazon-q-developer-cli/refs/heads/main/schemas/agent-v1.json";

const SKILL_URI_GLOBAL = "skill://~/.kiro/skills/**/SKILL.md";
const SKILL_URI_WORKSPACE = "skill://.kiro/skills/**/SKILL.md";

/**
 * True iff any knowledge source on the agent has refresh mode session or
 * always — the two modes that require a per-session hook. Mirrors the
 * helper in claude-code.ts; kept inline so the kiro translator stays
 * self-contained.
 */
function hasSessionRefresh(config: CanonicalConfig): boolean {
  const sources = config.knowledge?.sources;
  if (!sources || sources.length === 0) return false;
  for (const s of sources) {
    const normalized = parseRefresh(s.refresh);
    if (normalized.mode === "session" || normalized.mode === "always") return true;
  }
  return false;
}

function buildAgentSpawnHook(agentName: string): Record<string, unknown> {
  return {
    agentSpawn: [
      { command: `smith knowledge refresh-session --agent ${agentName} --platform kiro` },
    ],
  };
}

/**
 * Extract the broadest skill action from a PermissionConfig. Pattern records
 * collapse to their broadest action (allow > ask > deny), matching
 * `expandPermissionToToolList` precedence.
 */
function readSkillAction(
  permission: NonNullable<CanonicalConfig["permission"]>,
): "allow" | "ask" | "deny" | undefined {
  const v = permission["skill" as keyof typeof permission];
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  // Pattern record (e.g. { brainstorming: "allow", "*": "deny" }).
  const actions = Object.values(v) as Array<"allow" | "ask" | "deny">;
  if (actions.includes("allow")) return "allow";
  if (actions.includes("ask")) return "ask";
  return "deny";
}

export function translateKiro(
  config: CanonicalConfig,
  body: string,
  ctx: ResolvedModelContext,
): RenderedAgent {
  const data: Record<string, unknown> = {
    $schema: SCHEMA_URL,
    name: config.name,
    description: config.description,
    prompt: body,
  };
  if (ctx.resolvedModel !== undefined) data.model = ctx.resolvedModel;

  const warnings: string[] = [];
  const resources: string[] = [];

  if (config.permission !== undefined) {
    const result = expandPermissionToToolList(config.permission, KIRO_TOOL_MAP);
    warnings.push(...result.warnings);

    // Kiro's two-tier model: tools[] is visibility (the agent CAN use these);
    // allowedTools[] is auto-approve (no per-call prompt).
    //   allow → both lists
    //   ask   → tools[] only (kiro's runtime prompts at use-site)
    //   deny  → omit from both (positive allowlist)
    const toolsSet = new Set<string>([...result.allow, ...result.ask]);
    const tools = Array.from(toolsSet).sort();
    const allowedTools = [...result.allow].sort();

    if (tools.length > 0) data.tools = tools;
    if (allowedTools.length > 0) data.allowedTools = allowedTools;

    // permission.skill — three-case behavior per design §5.2 / Q12:
    //   allow → emit both skill:// globs (workspace + global)
    //   ask   → emit skill:// globs AND warn (kiro can't gate per-invocation)
    //   deny  → omit skill:// AND warn (kiro can't fully prevent skill access
    //           from a custom agent — partial enforcement only)
    const skillAction = readSkillAction(config.permission);
    if (skillAction === "allow") {
      resources.push(SKILL_URI_GLOBAL, SKILL_URI_WORKSPACE);
    } else if (skillAction === "ask") {
      resources.push(SKILL_URI_GLOBAL, SKILL_URI_WORKSPACE);
      warnings.push(
        "permission.skill: ask has no native equivalent on kiro; defaulting to allow. Skills will activate via description match and /<name> slash commands without per-invocation prompts.",
      );
    } else if (skillAction === "deny") {
      warnings.push(
        "permission.skill: deny — kiro cannot fully prevent skill access from a custom agent. Skills installed at ~/.kiro/skills/ remain reachable via the /<name> slash command and (when configured) the @builder-mcp/SkillsTool MCP. Omitting skill:// from resources only disables progressive-disclosure pre-loading. For strict skill isolation, use a platform with native skill gating (claude-code, opencode).",
      );
    }
  }

  if (resources.length > 0) {
    data.resources = resources.slice().sort();
  }

  // Refresh hook gating mirrors claude-code.ts: emit only when the install
  // CLI has captured explicit user consent (ctx.withRefreshHooks === true)
  // AND the bundle declares session/always sources.
  if (ctx.withRefreshHooks === true && hasSessionRefresh(config)) {
    data.hooks = buildAgentSpawnHook(config.name);
  }

  return {
    target: "kiro",
    format: "json",
    relativePath: `${config.name}.json`,
    data,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
