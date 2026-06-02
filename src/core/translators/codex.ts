import { dump } from "js-yaml";
import { CODEX_TOOL_MAP, expandPermissionToToolList } from "../permission-mapping";
import type { CanonicalConfig, RenderedAgent, ResolvedModelContext } from "../types";

/**
 * Translate a canonical agent config to codex's on-disk shape.
 *
 * Frontmatter is intentionally minimal: `name`, `description`, and
 * `allowed_tools` (snake_case, array form per existing codex convention).
 * No `model`/`mode`/`temperature`/`color`/`permission` — codex doesn't
 * consume them today.
 *
 * Permissions are derived from `config.permission` via `CODEX_TOOL_MAP`.
 * Codex uses a positive allowlist, so:
 *   - `allow` actions accumulate into `allowed_tools`.
 *   - `ask` has no codex equivalent → one warning per affected tool.
 *   - `deny` is implicit by omission → one summary warning.
 *   - `skill` has no codex runtime → one explicit warning (group is also
 *     absent from the codex tool-map, so no allowed_tools entry is emitted).
 *   - Pattern-based permission warnings flow through from the mapping module.
 *
 * Codex's tool vocabulary isn't finalized upstream (see v0.2.0 spec §9
 * risk register / data/codex-tool-map.json _meta.notes), so groups outside
 * the map are silently skipped by `expandPermissionToToolList`.
 *
 * Per-agent MCP emission: emits `<name>/agents/openai.yaml` as a sibling
 * sidecar when the bundle declares a non-empty `mcpServers`. The sidecar
 * follows the canonical `dependencies.tools[]` shape consumed by Codex's
 * install-prompt UX. The receiving feature
 * (codex-rs/core/src/mcp_skill_dependencies.rs) remains gated upstream on
 * `is_first_party_originator()` in codex-rs/login/src/auth/default_client.rs,
 * so third-party Codex wrappers get nothing from the install-prompt path
 * today. Emission is still useful as a documentation surface for any tool
 * inspecting agent bundles, and unlocks the receiving feature for free if
 * the originator gate is ever lifted. When `mcpServers` is empty/absent
 * the sidecar field is omitted entirely (byte-identical to prior output).
 */
export function translateCodex(
  config: CanonicalConfig,
  body: string,
  _ctx: ResolvedModelContext,
): RenderedAgent {
  const frontmatter: Record<string, unknown> = {
    name: config.name,
    description: config.description,
  };
  const warnings: string[] = [];

  if (config.permission !== undefined) {
    const result = expandPermissionToToolList(config.permission, CODEX_TOOL_MAP);

    // Pattern-based pass-through warnings come first (preserve mapping order).
    warnings.push(...result.warnings);

    // `ask`: codex has no equivalent. Per-tool warning, parallel to claude-code.
    for (const tool of result.ask) {
      warnings.push(
        `Permission action 'ask' has no codex equivalent for tool '${tool}'; omitting. Use 'allow' or 'deny'.`,
      );
    }

    // `deny` and `permission.skill` are platform truisms for codex (positive
    // allowlist; no skills runtime). Both are documented in
    // guide/06-permissions-and-platforms.md and would fire on virtually
    // every install — suppressing them here keeps install output focused
    // on things the user can actually act on.

    if (result.allow.length > 0) {
      frontmatter.allowed_tools = result.allow;
    }
  }

  // Sidecar emission: `<name>/agents/openai.yaml` listing each declared
  // MCP server in the canonical `dependencies.tools[]` shape. We emit
  // ONLY when the bundle has a non-empty `mcpServers` so bundles without
  // any MCP deps stay byte-identical to their pre-sidecar output.
  const mcpServers = config.mcpServers ?? [];
  const sidecars: NonNullable<RenderedAgent["sidecars"]> = [];
  if (mcpServers.length > 0) {
    const sidecarDoc = {
      dependencies: {
        tools: mcpServers.map((name) => ({
          type: "mcp",
          value: name,
          // No per-server description field exists on CanonicalConfig
          // today; emit empty string for the schema slot. If/when a
          // future `mcpServerDescriptions` field lands it can flow in
          // here without changing the sidecar's wire shape.
          description: "",
        })),
      },
    };
    const yaml = dump(sidecarDoc, { lineWidth: 0, noRefs: true });
    sidecars.push({
      relativePath: `${config.name}/agents/openai.yaml`,
      content: yaml,
    });
  }

  return {
    target: "codex",
    format: "markdown-frontmatter",
    // Codex installs agents AS skills under <name>/SKILL.md per the
    // AGENTS.md convention. The translator now owns this path shape end-
    // to-end (the installer's old codex special-case is removed in Task 1.3).
    relativePath: `${config.name}/SKILL.md`,
    frontmatter,
    body,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(sidecars.length > 0 ? { sidecars } : {}),
  };
}
