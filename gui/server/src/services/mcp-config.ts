/**
 * Thin re-export shim around the canonical implementation in
 * `src/io/mcp-wiring.ts`. The CLI's `smith knowledge wire/unwire` command
 * shares the same write/detect logic with the GUI toggle, so the impl was
 * lifted into the shared `src/io/` tree. This file preserves the GUI
 * server's existing import paths (`./services/mcp-config`) — call sites
 * elsewhere in the GUI server tree are unchanged.
 *
 * The shim threads in the GUI's caching `resolveSmithPath` (with its
 * argv1/~/.local/bin/which fallback chain and result cache) so writes from
 * the toggle path keep their existing behaviour. The CLI command injects
 * its own resolver.
 */
import {
  type DetectInput,
  defaultMcpConfigPaths,
  detectMcpStatus,
  keyForAgent,
  type McpPlatform,
  MCP_PLATFORMS,
  type PlatformMcpStatus,
  removeMcpEntry as removeMcpEntryShared,
  writeMcpEntry as writeMcpEntryShared,
} from "../../../../src/io/mcp-wiring";
import { resolveSmithPath } from "./resolve-smith-path";

export {
  defaultMcpConfigPaths,
  detectMcpStatus,
  keyForAgent,
  type DetectInput,
  type McpPlatform,
  MCP_PLATFORMS,
  type PlatformMcpStatus,
};

export interface WriteEntryInput {
  platform: McpPlatform;
  agent: string;
  configPath: string;
}

/**
 * Add the per-agent MCP entry (`<agent>-knowledge`) to the named platform's
 * config file. The GUI's caching `resolveSmithPath` is bound automatically.
 */
export async function writeMcpEntry(input: WriteEntryInput): Promise<void> {
  return writeMcpEntryShared({ ...input, resolveSmithPath });
}

/** Remove the per-agent MCP entry from the named platform's config file. */
export async function removeMcpEntry(input: WriteEntryInput): Promise<void> {
  return removeMcpEntryShared(input);
}
