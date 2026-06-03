import type { McpToolDescriptor } from "../../io/mcp-client";

/**
 * The `_meta` namespace key MCP servers use to advertise URL-routing
 * claims to smith. Per the MCP spec's `_meta` namespacing rules, any
 * prefix where the second label is `modelcontextprotocol` or `mcp` is
 * reserved; `dev.agent-smith` is a valid third-party namespace.
 *
 * Forward-compatible with the spec's roadmap "Server Cards" feature
 * (a `.well-known` URL exposing the same metadata).
 */
export const FETCH_DOMAINS_KEY = "dev.agent-smith/fetchDomains";

export interface MetaClaim {
  server: string;
  tool: string;
  urlPatterns: string[];
}

export function extractMetaClaims(server: string, tools: McpToolDescriptor[]): MetaClaim[] {
  const claims: MetaClaim[] = [];
  for (const tool of tools) {
    const meta = tool._meta;
    if (!meta || typeof meta !== "object") continue;
    const raw = (meta as Record<string, unknown>)[FETCH_DOMAINS_KEY];
    if (!Array.isArray(raw)) continue;
    const urlPatterns = raw.filter((v): v is string => typeof v === "string");
    if (urlPatterns.length === 0) continue;
    claims.push({ server, tool: tool.name, urlPatterns });
  }
  return claims;
}

/**
 * Find the most-specific claim matching the URL. Same precedence rule as
 * route-cache: longest literal prefix wins.
 */
export function matchMetaClaim(claims: MetaClaim[], url: string): MetaClaim | undefined {
  const candidates: Array<{ claim: MetaClaim; specificity: number }> = [];
  for (const claim of claims) {
    for (const pattern of claim.urlPatterns) {
      const literal = pattern.replace(/\*\*$/, "");
      if (url.startsWith(literal)) {
        candidates.push({ claim, specificity: literal.length });
      }
    }
  }
  candidates.sort((a, b) => b.specificity - a.specificity);
  return candidates[0]?.claim;
}
