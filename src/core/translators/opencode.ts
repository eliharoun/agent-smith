import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";

/**
 * OpenCode translator.
 *
 * Per-agent MCP emission policy: NONE. OpenCode agents default to
 * inheriting all global MCP servers from `opencode.json`, which already
 * matches user intent for a bundle declaring `mcpServers: [...]`. Per-
 * agent restriction would require synthesizing OpenCode's permission-block
 * vocabulary, which is a separate concern from MCP availability and is
 * tracked elsewhere. The bundle's `mcpServers` field is therefore consumed
 * by the validator (warning if a declared server isn't in
 * `~/.config/opencode/mcp.json`) but NOT emitted to opencode frontmatter.
 */
export function translateOpenCode(
  config: CanonicalConfig,
  body: string,
  ctx: ResolvedModelContext,
): RenderedAgent {
  const frontmatter: Record<string, unknown> = {
    description: config.description,
  };
  if (config.mode !== undefined) frontmatter.mode = config.mode;
  if (ctx.resolvedModel !== undefined) frontmatter.model = ctx.resolvedModel;
  if (config.temperature !== undefined) frontmatter.temperature = config.temperature;
  if (config.color !== undefined) frontmatter.color = config.color;
  if (config.permission !== undefined) frontmatter.permission = config.permission;

  return {
    target: "opencode",
    format: "markdown-frontmatter",
    relativePath: `${config.name}.md`,
    frontmatter,
    body,
  };
}
