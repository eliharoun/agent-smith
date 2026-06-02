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
    // AGENTS.md is consumed by external tools (Cursor, Windsurf, Copilot,
    // etc.) and lives at the project or home root, not a platform-managed
    // agents directory. The translator emits a relative path (default
    // "AGENTS.md") which the installer joins with this root.
    //
    // TODO(T5b/follow-up): InstallPaths is currently global (one set per
    // install run, not per bundle), so this resolves to `~` for every
    // bundle regardless of source kind. This works for `user-global`
    // bundles (lands at ~/AGENTS.md), but project/registered bundles
    // probably want their AGENTS.md at the bundle's project root. For
    // those, users can set `targetOptions.agentsMd.path` to an absolute
    // or repo-relative path. A future PR can extend InstallPaths to be
    // bundle-aware so the default does the right thing automatically.
    "agents-md": homedir(),
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
 * This helper exists for the refresh-hook consent flow where smith
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
 * registration flow where smith writes
 * `<opencodeHome>/plugins/agent-smith-refresh/` and updates `opencode.json`.
 */
export function defaultOpencodeConfigHome(): string {
  return join(homedir(), ".config/opencode");
}

export function defaultKnowledgePaths(): KnowledgePaths {
  return { agentSmithHome: defaultAgentSmithHome() };
}
