import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * Read-only union of MCP server names + spawn opts from each platform's
 * canonical MCP config location:
 *   - claude-code: ~/.claude.json (user-scope mcpServers + project-scope projects.<dir>.mcpServers)
 *   - codex:       ~/.codex/config.toml ([mcp_servers.<name>])
 *   - opencode:    ~/.config/opencode/opencode.json (mcp.<name>)
 *   - kiro:        ~/.kiro/settings/mcp.json (mcpServers.<name>)
 *
 * Last-wins on duplicate names. Returns empty for missing/malformed files.
 *
 * Path layout matches src/io/mcp-availability.ts (the existing canonical
 * source for these locations) so doctor and preflight see the same set
 * of servers.
 */

export interface AvailableMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type AvailableMap = Record<string, AvailableMcpServer>;

export interface ReadOpts {
  homeDir: string;
}

export async function readAvailableMcpServers(opts: ReadOpts): Promise<AvailableMap> {
  const result: AvailableMap = {};
  Object.assign(result, await readClaude(opts.homeDir));
  Object.assign(result, await readKiro(opts.homeDir));
  Object.assign(result, await readCodex(opts.homeDir));
  Object.assign(result, await readOpenCode(opts.homeDir));
  return result;
}

async function readClaude(home: string): Promise<AvailableMap> {
  const path = join(home, ".claude.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(raw) as {
      mcpServers?: Record<string, AvailableMcpServer>;
      projects?: Record<string, { mcpServers?: Record<string, AvailableMcpServer> }>;
    };
    const result: AvailableMap = { ...(data.mcpServers ?? {}) };
    for (const proj of Object.values(data.projects ?? {})) {
      Object.assign(result, proj.mcpServers ?? {});
    }
    return result;
  } catch {
    return {};
  }
}

async function readKiro(home: string): Promise<AvailableMap> {
  return readJsonMcpServers(join(home, ".kiro", "settings", "mcp.json"));
}

async function readCodex(home: string): Promise<AvailableMap> {
  const path = join(home, ".codex", "config.toml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = parseToml(raw) as { mcp_servers?: Record<string, AvailableMcpServer> };
    return { ...(parsed.mcp_servers ?? {}) };
  } catch {
    return {};
  }
}

async function readOpenCode(home: string): Promise<AvailableMap> {
  const path = join(home, ".config", "opencode", "opencode.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { mcp?: Record<string, AvailableMcpServer> };
    return { ...(parsed.mcp ?? {}) };
  } catch {
    return {};
  }
}

async function readJsonMcpServers(path: string): Promise<AvailableMap> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, AvailableMcpServer> };
    return { ...(parsed.mcpServers ?? {}) };
  } catch {
    return {};
  }
}
