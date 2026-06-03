/**
 * Doctor section that audits each installed agent's `mcp.required[]` and
 * `mcp.peer[]` against the union of MCP configs found across all four
 * platform locations (claude-code, codex, opencode, kiro).
 *
 * Read-only by design — `smith doctor` does not install MCP servers; users do.
 * Repair is intentionally out of scope. The companion CLI surface
 * (`src/cli/commands/doctor.ts`) wires the real readers and the bundle loader,
 * while this module stays pure-by-DI so unit tests don't touch a real
 * `~/.claude.json` or registry.
 *
 * Findings shape:
 *   - One finding per (agent, server) pair.
 *   - `kind` is `"required"` or `"peer"`; `severity` mirrors that with
 *     `"error"` for required and `"warning"` for peer.
 *   - Order: agents in caller-supplied order, required listed before peer
 *     within an agent, declaration order within each kind.
 */
import type { AvailableMap } from "../../io/mcp-config-readers";

export interface InstalledAgentMcp {
  name: string;
  mcp?: { required?: string[]; peer?: string[] } | undefined;
}

export interface McpDepFinding {
  agent: string;
  server: string;
  kind: "required" | "peer";
  severity: "error" | "warning";
}

export interface CheckMcpDepsOpts {
  installedAgents: InstalledAgentMcp[];
  readAvailable: () => Promise<AvailableMap>;
}

/**
 * Walk every installed agent's `mcp` block and emit one finding per
 * declared server name that isn't present in the union of platform MCP
 * configs returned by `readAvailable`. Agents without an `mcp` block are
 * skipped silently — no `mcp` declaration means no dependency to audit.
 */
export async function checkMcpDeps(opts: CheckMcpDepsOpts): Promise<McpDepFinding[]> {
  const available = await opts.readAvailable();
  const findings: McpDepFinding[] = [];
  for (const agent of opts.installedAgents) {
    if (!agent.mcp) continue;
    for (const server of agent.mcp.required ?? []) {
      if (!(server in available)) {
        findings.push({ agent: agent.name, server, kind: "required", severity: "error" });
      }
    }
    for (const server of agent.mcp.peer ?? []) {
      if (!(server in available)) {
        findings.push({ agent: agent.name, server, kind: "peer", severity: "warning" });
      }
    }
  }
  return findings;
}
