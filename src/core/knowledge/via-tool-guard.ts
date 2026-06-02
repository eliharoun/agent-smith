import { SmithError } from "../smith-error";

/**
 * Read-shaped name allowlist. A `via.tool` name must start with one of these
 * prefixes (case-insensitive) OR the source must set `via.allowWriteTool: true`.
 * Default-deny prevents a malicious bundle from triggering write/destructive
 * tools on the recipient's MCP servers without the bundle author opting in.
 *
 * Prefixes chosen from observed MCP-server tool name conventions
 * (modelcontextprotocol/servers, github-mcp-server, sooperset/mcp-atlassian,
 * makenotion/notion-mcp-server). Names that don't start with one of these
 * are conservatively considered potentially destructive.
 */
const READ_SHAPED = /^(read|get|fetch|search|list|describe|preview|head)/i;

/**
 * Minimal structural shape consumed by the guard. The full `Via` interface
 * lands in `./types` in a follow-up task; declaring the parameter inline
 * keeps this module typecheck-clean today and lets `assertViaToolAllowed`
 * accept any object with the relevant fields.
 */
type ViaToolGuardInput = {
  server: string;
  tool: string;
  allowWriteTool?: boolean;
};

export function assertViaToolAllowed(via: ViaToolGuardInput): void {
  if (via.allowWriteTool === true) return;
  if (READ_SHAPED.test(via.tool)) return;
  throw new SmithError({
    code: "validation-failed",
    what: `via.tool "${via.tool}" is not read-shaped (set allowWriteTool: true to opt in)`,
    reasons: [
      `tool name does not match read-shaped prefix /^(read|get|fetch|search|list|describe|preview|head)/i`,
      `if this is a write/destructive tool the bundle author intends to call, set "allowWriteTool": true on the via block`,
    ],
  });
}
