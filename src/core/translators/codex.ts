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
 * Per-agent MCP emission: NOT emitted in this iteration. Codex defaults
 * to inheriting all global MCP servers from `~/.codex/config.toml` (so
 * runtime visibility matches user intent), but the idiomatic per-skill
 * "hint" is a sidecar `<name>/agents/openai.yaml` with `dependencies.tools`
 * — used by the install-prompt UX to ask the user about missing servers.
 *
 * Status (verified June 2026 against openai/codex HEAD):
 *   - The feature flag `skill_mcp_dependency_install` is now `Stage::Stable`
 *     with `default_enabled: true` (codex-rs/features/src/lib.rs). So the
 *     flag itself is no longer the gate.
 *   - The BINDING constraint is `is_first_party_originator()` in
 *     codex-rs/login/src/auth/default_client.rs, which only accepts
 *     official OpenAI clients (codex-tui, codex_vscode, codex_atlas,
 *     codex_chatgpt_desktop, "Codex *"). Third-party Codex wrappers —
 *     i.e. most agent-smith user environments — get nothing from the
 *     install-prompt path: it short-circuits early.
 *   - `dependencies.tools` is still purely additive. No subtractive
 *     scoping field has appeared on `SkillToolDependency` or `SkillPolicy`.
 *     So even if the originator gate were lifted, emitting the sidecar
 *     would be a UX hint, not a per-agent MCP boundary like Claude
 *     Code's frontmatter or Kiro's mcpServers map.
 *
 * Implementation cost (revised after concrete read of the codebase): the
 * earlier "multi-day refactor" framing was overstated. Adding an optional
 * `sidecars: Array<{relativePath, content}>` to `RenderedAgentBase`
 * (without changing the discriminated union) plus parallel write/dedup/
 * uninstall plumbing is ~150 LOC + tests, ~1 day of focused work.
 *
 * Re-evaluation triggers — if any of these change, ship the sidecar:
 *   1. A `scope`/`expose`/`restrict_to` field appears on
 *      `SkillToolDependency` upstream (subtractive scoping).
 *   2. Per-skill MCP visibility filtering lands in
 *      codex-rs/core/src/mcp_tool_exposure.rs.
 *   3. The first-party originator gate is removed from
 *      `maybe_prompt_and_install_mcp_dependencies`.
 *
 * Until then: tracked as a follow-up; deferred indefinitely.
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
  };
}
