import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Mirror of `defaultAgentSmithHome()` from `src/cli/install-paths.ts` /
 * `src/io/state-home.ts`. Returns `$XDG_CONFIG_HOME/agent-smith`
 * (empty-as-unset XDG semantics) or `~/.config/agent-smith` when unset.
 * Inlined (not imported from `src/io/state-home.ts`) because the
 * gui/server package cannot cleanly import across the package boundary;
 * same pattern as `gui/server/src/services/refresh-manifest.ts`.
 */
export function defaultAgentSmithHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".config", "agent-smith");
}

/**
 * Mirror of the per-source refresh-cache layout from
 * `src/core/knowledge/refresh-cache.ts`:
 *   `$XDG_CACHE_HOME/agent-smith/agents/<safeName>/sources`
 * (or `~/.cache/agent-smith/...` when XDG_CACHE_HOME is unset).
 */
export function defaultCacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".cache", "agent-smith");
}

/**
 * State root for daemon/GUI runtime files (PID, heartbeat, job history).
 * `$XDG_STATE_HOME/agent-smith` or `~/.local/state/agent-smith` when unset.
 * Per Phase 3 Amendment M: gui-jobs.jsonl + gui-jobs-output/ live here.
 */
export function defaultStateRoot(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".local", "state", "agent-smith");
}

export function refreshCacheDirFor(agent: string, cacheRoot = defaultCacheRoot()): string {
  return join(cacheRoot, "agents", safeFsName(agent), "sources");
}

export function refreshManifestPathFor(
  agent: string,
  agentSmithHome = defaultAgentSmithHome(),
): string {
  // Sibling of `<agentSmithHome>/agents/`. Mirrors the CLI writer in
  // `src/core/knowledge/refresh-manifest.ts`. Prior layout was
  // `<home>/agents/<agent>/refresh-manifest.json`, which created a
  // phantom bundle dir under user-global when the source was synthetic
  // self.
  return join(agentSmithHome, "refresh", safeFsName(agent), "refresh-manifest.json");
}

export function knowledgeManifestPathFor(
  agent: string,
  agentSmithHome = defaultAgentSmithHome(),
): string {
  return join(agentSmithHome, "knowledge", safeFsName(agent), "_manifest.json");
}

export function bundleDirCandidatesFor(agent: string, registryRoots: string[]): string[] {
  return registryRoots.map((r) => join(r, agent));
}

function safeFsName(s: string): string {
  // CONTRACT: must match `safeFsName()` in
  // `src/core/knowledge/refresh-cache.ts` exactly — that file writes the
  // .meta.json paths this module reads back. The two were previously
  // drifted (lax `[/\\]/g → _` here vs strict `[^A-Za-z0-9._-]/g → -`
  // there); kebab-case validation upstream masked the bug. Tests in
  // `cache-paths.test.ts` pin the contract.
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

export interface GuiJobsPaths {
  jsonlPath: string;
  outputDir: string;
}

/**
 * Canonical on-disk locations for GUI job history, derived from the state
 * root. Single source of truth shared by the server entry point
 * (`startGuiServer` -> JobManager history writer) and `createApp` (history
 * route + startup sweep) so the writer and reader can never drift.
 */
export function defaultGuiJobsPaths(stateRoot: string = defaultStateRoot()): GuiJobsPaths {
  return {
    jsonlPath: join(stateRoot, "gui-jobs.jsonl"),
    outputDir: join(stateRoot, "gui-jobs-output"),
  };
}
