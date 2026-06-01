import { CLAUDE_CODE_TOOL_MAP, expandPermissionToToolList } from "../permission-mapping";
import { parseRefresh } from "../knowledge/refresh-spec";
import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";
import { declaredMcpServers } from "./mcp-helpers";

/** Returns true if any knowledge source on the agent has refresh mode
 *  session or always — the two modes that require a per-session hook. */
function hasSessionRefresh(config: CanonicalConfig): boolean {
  const sources = config.knowledge?.sources;
  if (!sources || sources.length === 0) return false;
  for (const s of sources) {
    const normalized = parseRefresh(s.refresh);
    if (normalized.mode === "session" || normalized.mode === "always") return true;
  }
  return false;
}

/** Build the claude-code SessionStart hook block that invokes
 *  `smith knowledge refresh-session` on agent startup and resume. */
function sessionStartHook(agentName: string): Record<string, unknown> {
  return {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          {
            type: "command",
            command: `smith knowledge refresh-session --agent ${agentName} --platform claude-code`,
            statusMessage: `Refreshing ${agentName} knowledge…`,
            timeout: 5,
          },
        ],
      },
    ],
  };
}

export function translateClaudeCode(
  config: CanonicalConfig,
  body: string,
  ctx: ResolvedModelContext,
): RenderedAgent {
  const frontmatter: Record<string, unknown> = {
    name: config.name,
    description: config.description,
  };
  if (ctx.resolvedModel !== undefined) frontmatter.model = ctx.resolvedModel;
  const warnings: string[] = [];

  if (config.permission !== undefined) {
    const result = expandPermissionToToolList(config.permission, CLAUDE_CODE_TOOL_MAP);

    // 1. Pattern-based warnings forwarded from the mapping module first.
    warnings.push(...result.warnings);

    // 2. Per-tool warning for each tool in the `ask` bucket — claude-code has
    //    no native ask semantic, so we omit the tool entirely and tell the user.
    for (const tool of result.ask) {
      warnings.push(
        `Permission action 'ask' has no claude-code equivalent for tool '${tool}'; omitting. Use 'allow' or 'deny'.`,
      );
    }

    // `deny` is implicit in claude-code's positive allowlist: denied tools
    // simply don't appear in `allowed-tools`. This is a permanent platform
    // fact (documented in guide/06-permissions-and-platforms.md), so the
    // translator does NOT emit a runtime warning for it. Suppressing this
    // would have produced a "deny → omitted" line on every install with
    // any deny rule, which is virtually every install.

    // Emit `allowed-tools` only when at least one tool ended up in `allow`.
    if (result.allow.length > 0) {
      frontmatter["allowed-tools"] = result.allow.join(", ");
    }
  }

  // Per-agent MCP scoping. Claude Code defaults to inheriting ALL global
  // MCP servers; emitting `mcpServers:` frontmatter RESTRICTS the agent to
  // the named subset. Opt-in is implicit (default `true` when the bundle
  // declares non-empty `mcpServers`); opt out per-bundle via
  // `targetOptions.claudeCode.scopeMcpServers: false`.
  const declaredMcp = declaredMcpServers(config);
  const scopeMcp =
    config.targetOptions?.claudeCode?.scopeMcpServers ?? declaredMcp.length > 0;
  if (scopeMcp && declaredMcp.length > 0) {
    frontmatter.mcpServers = declaredMcp;
  }

  // Gate on explicit opt-in via ctx.withRefreshHooks. The translator
  // never decides on its own whether to emit hooks — that's a CLI
  // consent concern (spec §5.2). Without this gate, `--no-refresh-hooks`
  // and a declined consent prompt still produced orphan hooks because
  // the file was written before consent was asked.
  if (ctx.withRefreshHooks === true && hasSessionRefresh(config)) {
    frontmatter.hooks = sessionStartHook(config.name);
  }

  // Defer-to-AGENTS.md: when both targets are declared on the same bundle,
  // the canonical body lives in AGENTS.md and CLAUDE.md becomes a 1-line
  // pointer so the two files don't drift. The default kicks in when both
  // targets are present; users can opt out per-bundle by setting
  // `targetOptions.claudeCode.deferToAgentsMd: false`. Frontmatter (model,
  // permissions, hooks) is preserved either way — the pointer only
  // replaces the body.
  const bothTargeted =
    config.targets.includes("agents-md") && config.targets.includes("claude-code");
  const defer = config.targetOptions?.claudeCode?.deferToAgentsMd ?? bothTargeted;
  const finalBody = defer ? "See AGENTS.md." : body;

  return {
    target: "claude-code",
    format: "markdown-frontmatter",
    relativePath: `${config.name}.md`,
    frontmatter,
    body: finalBody,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
