import { homedir } from "node:os";
import { join } from "node:path";
import type { InstallPaths } from "../core/types";
import type { KnowledgePaths } from "../io/knowledge-paths";
import { stateHome } from "../io/state-home";

export function defaultInstallPaths(): InstallPaths {
  return {
    opencode: join(homedir(), ".config/opencode/agents"),
    "claude-code": join(homedir(), ".claude/agents"),
    codex: join(homedir(), ".agents/skills"),
    kiro: join(homedir(), ".kiro/agents"),
  };
}

/**
 * Default location for agent-smith's own state home, where materialized
 * knowledge lives (alongside `USER.md`). Kept separate from `InstallPaths`
 * (which is `Record<Target, string>`) because knowledge is not platform-keyed.
 */
export function defaultAgentSmithHome(): string {
  return stateHome();
}

/**
 * Default Codex config home — the directory containing `hooks.json` and the
 * other Codex CLI state. Distinct from the install target in
 * `defaultInstallPaths().codex` (which is the *skills* dir, `~/.agents/skills`).
 * This helper exists for the refresh-hook consent flow (Phase 4) where smith
 * registers agents in `<codexHome>/hooks.json`.
 */
export function defaultCodexHome(): string {
  return join(homedir(), ".codex");
}

/**
 * Default OpenCode config home — the directory containing `opencode.json`
 * and the `plugins/` subdir. Distinct from the install target in
 * `defaultInstallPaths().opencode` (which is the *agents* dir,
 * `~/.config/opencode/agents`). This helper exists for the refresh-plugin
 * registration flow (Phase 5) where smith writes
 * `<opencodeHome>/plugins/agent-smith-refresh/` and updates `opencode.json`.
 */
export function defaultOpencodeConfigHome(): string {
  return join(homedir(), ".config/opencode");
}

export function defaultKnowledgePaths(): KnowledgePaths {
  return { agentSmithHome: defaultAgentSmithHome() };
}
