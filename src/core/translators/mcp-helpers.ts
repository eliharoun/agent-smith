/**
 * Per-platform MCP-emission helpers.
 *
 * Background: bundle config has `mcpServers: string[]` (a list of server
 * NAMES the agent depends on). agent-smith doesn't write spawn configs into
 * the bundle — those live in the user's global per-platform MCP config files
 * (`~/.codex/config.toml`, `~/.kiro/settings/mcp.json`, etc.). Each
 * platform's translator uses these helpers to emit the per-agent MCP
 * declarations idiomatically:
 *
 * - OpenCode  → no emission (default-inherit-all matches user intent).
 * - Claude    → `mcpServers:` frontmatter as list of name-strings (subset
 *                scoping, opt-out via targetOptions.claudeCode.scopeMcpServers=false).
 * - Codex     → emits `<name>/agents/openai.yaml` sidecar with
 *                `dependencies.tools[]` listing each declared MCP server
 *                from BOTH `config.mcpServers` (per-agent scope hint) AND
 *                `config.mcp.required` (bundle-level dependency, v1.2).
 *                Deduplicated by name. Consumed by Codex's install-prompt
 *                UX (still gated upstream on `is_first_party_originator()`
 *                per codex-rs/core/src/mcp_skill_dependencies.rs, so
 *                third-party Codex wrappers see no UX effect today —
 *                emission is still useful as a documentation surface
 *                and unlocks the receiving feature if the originator
 *                gate is ever lifted). Implementation lives in
 *                `src/core/translators/codex.ts`; sidecar plumbing
 *                lives in `src/core/types.ts:RenderedAgentBase.sidecars`,
 *                `src/io/installer.ts`, `src/io/uninstaller.ts`.
 * - Kiro      → `mcpServers: {}` empty + `includeMcpJson: true` +
 *                `tools` and `allowedTools` curated with `@<server>` entries.
 *                Per AWS's SageMaker reference agent pattern.
 */

import type { CanonicalConfig } from "../types";

/**
 * Read the bundle's declared MCP server names. Deduplicates and sorts so
 * downstream emission is deterministic. Returns an empty array when the
 * field is absent or empty.
 */
export function declaredMcpServers(config: CanonicalConfig): string[] {
  const list = config.mcpServers;
  if (!list || list.length === 0) return [];
  const seen = new Set<string>();
  for (const name of list) {
    if (typeof name === "string" && name.length > 0) seen.add(name);
  }
  return Array.from(seen).sort();
}
