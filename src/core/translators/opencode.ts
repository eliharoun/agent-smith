import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";

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
