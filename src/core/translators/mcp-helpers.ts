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
 * - Codex     → no emission this iteration. Codex's idiomatic per-skill
 *                hint mechanism is `<skill>/agents/openai.yaml` with
 *                `dependencies.tools`, but that's install-prompt-only and
 *                gated behind a first-party feature flag. The infra to emit
 *                a SECOND file per render (extending `RenderedAgent`,
 *                installer manifest, uninstaller cleanup) is out of scope
 *                for this iteration. Tracked as a follow-up.
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
