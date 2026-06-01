import { parse as parseToml } from "smol-toml";
import type { CanonicalConfig, Target } from "../core/types";

export interface McpAvailabilityPaths {
  /** OpenCode global config, e.g. `~/.config/opencode/opencode.json`. MCP servers live under the top-level `mcp` key. */
  opencodeConfig: string;
  /**
   * Claude Code config, e.g. `~/.claude.json`. User-scope servers live under
   * top-level `mcpServers`; local-scope servers live under
   * `projects.<path>.mcpServers`. Both are unioned for the availability check.
   */
  claudeMcpConfig: string;
  /** Codex global config, e.g. `~/.codex/config.toml`. Servers live as `[mcp_servers.<name>]` sections. */
  codexConfig: string;
}

/**
 * Best-effort check that each MCP server referenced by the agent is configured
 * on each target platform's global MCP config. Missing/unreadable config files
 * are silent (returns no warnings for that target) — rationale: a user may not
 * use a given platform, so we shouldn't nag them about its missing config.
 * Returns warning strings (never errors).
 */
export async function checkMcpAvailability(
  config: CanonicalConfig,
  paths: McpAvailabilityPaths,
): Promise<string[]> {
  if (!config.mcpServers || config.mcpServers.length === 0) return [];
  const warnings: string[] = [];
  for (const target of config.targets) {
    const installed = await readPlatformMcpServers(target, paths);
    if (installed === null) continue;
    for (const server of config.mcpServers) {
      if (!installed.has(server)) {
        warnings.push(`MCP server '${server}' referenced but not configured for ${target}`);
      }
    }
  }
  return warnings;
}

async function readPlatformMcpServers(
  target: Target,
  paths: McpAvailabilityPaths,
): Promise<Set<string> | null> {
  switch (target) {
    case "opencode":
      return readJsonServers(paths.opencodeConfig, "mcp");
    case "claude-code":
      return readClaudeCodeServers(paths.claudeMcpConfig);
    case "codex":
      return readTomlMcpSections(paths.codexConfig);
    case "kiro":
      // Kiro: per-agent mcpServers field is documented but smith doesn't
      // emit a global MCP config check today (the design defers per-agent
      // MCP spec emission to future work — see the design's §12 future work).
      // Return null so the caller treats kiro as "no global MCP config to
      // check" — consistent with how missing config files behave for the
      // other platforms.
      return null;
    case "agents-md":
      // AGENTS.md is a plain markdown file consumed by external tools
      // (Cursor, Windsurf, Copilot, etc.) — each tool has its own MCP
      // system with no shared global config. There is no single file
      // smith can probe for "is this MCP server installed?". Return null
      // so the caller treats agents-md as "no MCP config to check",
      // mirroring kiro's behaviour.
      return null;
  }
}

async function readJsonServers(path: string, key: string): Promise<Set<string> | null> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    const data = (await f.json()) as Record<string, unknown>;
    const section = data[key];
    if (!section || typeof section !== "object") return new Set();
    return new Set(Object.keys(section as Record<string, unknown>));
  } catch {
    return null;
  }
}

/**
 * Claude Code stores MCP servers in `~/.claude.json` at two locations:
 * `mcpServers` (user scope, cross-project) and `projects.<path>.mcpServers`
 * (local scope, scoped to a single project directory). The availability
 * check considers a server present if it appears in either location.
 */
async function readClaudeCodeServers(path: string): Promise<Set<string> | null> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    const data = (await f.json()) as Record<string, unknown>;
    const names = new Set<string>();
    const userScope = data.mcpServers;
    if (userScope && typeof userScope === "object") {
      for (const key of Object.keys(userScope as Record<string, unknown>)) names.add(key);
    }
    const projects = data.projects;
    if (projects && typeof projects === "object") {
      for (const project of Object.values(projects as Record<string, unknown>)) {
        if (!project || typeof project !== "object") continue;
        const projectServers = (project as Record<string, unknown>).mcpServers;
        if (!projectServers || typeof projectServers !== "object") continue;
        for (const key of Object.keys(projectServers as Record<string, unknown>)) names.add(key);
      }
    }
    return names;
  } catch {
    return null;
  }
}

async function readTomlMcpSections(path: string): Promise<Set<string> | null> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    const text = await f.text();
    const parsed = parseToml(text) as Record<string, unknown>;
    // Codex spec dictates `[mcp_servers.<name>]` sections — key is fixed by the format.
    const mcp = parsed.mcp_servers;
    if (!mcp || typeof mcp !== "object") return new Set();
    return new Set(Object.keys(mcp as Record<string, unknown>));
  } catch {
    return null;
  }
}
