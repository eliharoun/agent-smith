import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";

/**
 * Render a canonical bundle as AGENTS.md — the cross-tool plain-markdown
 * convention consumed by Cursor, Windsurf, Copilot, and other AGENTS.md-aware
 * tools. Emits no frontmatter (an empty `frontmatter: {}` keeps the
 * installer's serialization dispatch on `format: "markdown-frontmatter"`
 * happy without inventing a new format).
 *
 * The body is prefixed with a `# <name>` header + the description, then a
 * blank line, then the assembled body. The relative path defaults to
 * `AGENTS.md` and can be overridden via `targetOptions.agentsMd.path` for
 * bundles that want to land at e.g. `docs/AGENTS.md` instead of the repo
 * root.
 */
export function translateAgentsMd(
  config: CanonicalConfig,
  body: string,
  _ctx: ResolvedModelContext,
): RenderedAgent {
  const path = config.targetOptions?.agentsMd?.path ?? "AGENTS.md";
  const header = `# ${config.name}\n\n${config.description}\n`;
  return {
    target: "agents-md",
    relativePath: path,
    format: "markdown-frontmatter",
    frontmatter: {},
    body: `${header}\n${body}`,
  };
}
