import type { AvailableMap } from "../../../io/mcp-config-readers";

export interface McpDepsBlock {
  required?: string[];
  peer?: string[];
}

export interface PreflightResult {
  requiredMissing: string[];
  peerMissing: string[];
}

/**
 * Install-time preflight. Pure function — never reads disk, never
 * writes. The caller is responsible for resolving `available` via
 * `readAvailableMcpServers`.
 *
 * Semantics mirror npm:
 *   - `required` missing → install refuses (returns name in requiredMissing)
 *   - `peer` missing → install warns but proceeds
 *
 * Order is preserved from the bundle's declarations so error messages
 * are deterministic.
 */
export function preflightMcp(
  block: McpDepsBlock,
  available: AvailableMap,
): PreflightResult {
  const requiredMissing = (block.required ?? []).filter((name) => !(name in available));
  const peerMissing = (block.peer ?? []).filter((name) => !(name in available));
  return { requiredMissing, peerMissing };
}
