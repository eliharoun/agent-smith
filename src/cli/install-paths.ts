import { homedir } from "node:os";
import { join } from "node:path";
import type { InstallPaths, Source } from "../core/types";
import type { KnowledgePaths } from "../io/knowledge-paths";
import { stateHome } from "../io/state-home";

export function defaultInstallPaths(): InstallPaths {
  return {
    opencode: join(homedir(), ".config/opencode/agents"),
    "claude-code": join(homedir(), ".claude/agents"),
    codex: join(homedir(), ".agents/skills"),
    kiro: join(homedir(), ".kiro/agents"),
    // AGENTS.md is consumed by external tools (Cursor, Windsurf, Copilot, etc.)
    // and lives at the project or home root, not a platform-managed agents dir.
    // This flat default is `homedir()` for backward compatibility; the
    // orchestrator overrides it per bundle via `resolveAgentsMdRoot(source)`
    // (user-global → home, project/registered → the bundle's catalog root).
    "agents-md": homedir(),
  };
}

/**
 * Filesystem root the `agents-md` target writes under, resolved per source
 * kind. `user-global` bundles keep `userGlobalRoot` (the configured
 * `paths["agents-md"]`, which defaults to `homedir()` — overridable for tests
 * and custom homes); a `project`/`registered` bundle writes under its own
 * catalog root (`source.rootPath`) so its AGENTS.md ships with the bundle
 * instead of polluting `$HOME`. The render's relative path (default
 * "AGENTS.md", or `targetOptions.agentsMd.path`) is joined against this root by
 * the orchestrator; an absolute configured path is used as-is. We deliberately
 * do NOT infer a "repo root" from `rootPath` — it is whatever was registered,
 * with no enforced layout.
 */
export function resolveAgentsMdRoot(source: Source, userGlobalRoot: string): string {
  return source.kind === "user-global" ? userGlobalRoot : source.rootPath;
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
