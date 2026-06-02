import { SmithError } from "../core/smith-error";
import type { McpClientOpts } from "./mcp-client";
import { readAvailableMcpServers, type AvailableMap } from "./mcp-config-readers";

export interface ResolverOpts {
  homeDir: string;
}

/**
 * Build a `spawnOptsFor` resolver by reading the user's MCP config
 * once. The returned function is sync — it operates on the cached map.
 * Re-reading on every lookup would re-spawn IO per source.
 *
 * Throws SmithError if the named server isn't configured anywhere.
 */
export async function createSpawnOptsResolver(
  opts: ResolverOpts,
): Promise<(name: string) => McpClientOpts> {
  const map: AvailableMap = await readAvailableMcpServers(opts);
  return (name: string): McpClientOpts => {
    const entry = map[name];
    if (!entry) {
      throw new SmithError({
        code: "validation-failed",
        what: `mcp server '${name}'`,
        reasons: [
          `'${name}' is not configured in any platform MCP config (~/.claude.json, ~/.codex/config.toml, ~/.config/opencode/opencode.json, ~/.kiro/settings/mcp.json)`,
          `install it with your platform's documented procedure`,
        ],
      });
    }
    return {
      command: entry.command,
      ...(entry.args ? { args: entry.args } : {}),
      ...(entry.env ? { env: entry.env } : {}),
    };
  };
}
