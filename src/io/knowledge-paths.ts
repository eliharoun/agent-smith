import { join } from "node:path";

/**
 * Minimal paths-shape needed to locate the per-agent knowledge dir.
 *
 * Knowledge is materialized under agent-smith's own state home — NOT under
 * any platform's agent-discovery scope. Earlier versions placed knowledge
 * files under `~/.config/opencode/agents/<name>/knowledge/`, but opencode's
 * agent picker globs that directory recursively and treated every knowledge
 * `.md` as a selectable agent. Agent-smith owns its own state home for the
 * same reason `USER.md` lives there.
 */
export interface KnowledgePaths {
  /** Root of agent-smith's state home, e.g. `~/.config/agent-smith`. */
  agentSmithHome: string;
}

export function knowledgeDirFor(agentName: string, paths: KnowledgePaths): string {
  return join(paths.agentSmithHome, "knowledge", agentName);
}

export function cacheDirFor(agentName: string, paths: KnowledgePaths): string {
  return join(knowledgeDirFor(agentName, paths), ".cache");
}
