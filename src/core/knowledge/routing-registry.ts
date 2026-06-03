/**
 * Curated registry mapping URL patterns to suggested MCP fetcher tools.
 * Used by `smith knowledge add` to suggest a `via:` entry when the URL
 * matches a known pattern. **NOT used by acquire/refresh dispatch** —
 * those paths only follow explicit `via:` declarations.
 *
 * Why suggestion-only: real upstream MCP tool names vary by server
 * distribution and are hard to verify exhaustively. Auto-routing
 * silently against unverified tool names produces -32601 method-not-found
 * errors at runtime. Suggesting them at author time lets the author
 * verify against their actual MCP server before committing the bundle.
 *
 * A future `_meta` self-claim layer can let MCP servers self-advertise
 * which tools handle which domains, removing the need for this curated
 * registry to ship tool names at all.
 *
 * Tool names listed here are best-effort placeholders; users WILL need
 * to override with their server's actual tool name. The `knowledge add`
 * UX presents them as suggestions, not commitments.
 */

import {
  urlToConfluenceArgs,
  urlToGithubBlobArgs,
  urlToNotionArgs,
  urlToSharepointArgs,
} from "./route-args";

export interface RouteEntry {
  readonly server: string;
  readonly tool: string;
  readonly argMapper: (url: string) => Record<string, unknown>;
  /** Hints surfaced in `knowledge add` output: real upstream tool name varies. */
  readonly note?: string;
  /**
   * Human-readable URL pattern this curated entry matches, suitable for
   * surfacing in doctor output. Not consumed by the matcher — the
   * `match()` predicate is canonical.
   */
  readonly displayPattern?: string;
}

interface Pattern extends RouteEntry {
  readonly match: (url: URL) => boolean;
}

const PATTERNS: readonly Pattern[] = [
  {
    server: "atlassian-mcp",
    tool: "confluence_get_page",
    note: "Tool name varies by Atlassian MCP distribution; verify against your server's tools/list.",
    displayPattern: "https://*.atlassian.net/wiki/**",
    match: (u) => u.hostname.endsWith(".atlassian.net") && u.pathname.startsWith("/wiki/"),
    argMapper: urlToConfluenceArgs,
  },
  {
    server: "sharepoint-mcp",
    tool: "sharepoint_resolve_url",
    note: "URL-resolver tool — name varies by SharePoint MCP distribution.",
    displayPattern: "https://*.sharepoint.com/**",
    match: (u) => u.hostname.endsWith(".sharepoint.com"),
    argMapper: urlToSharepointArgs,
  },
  {
    server: "notion-mcp",
    tool: "retrieve_a_page",
    note: "Notion's official MCP uses tool names mirroring the HTTP API.",
    displayPattern: "https://www.notion.so/**",
    match: (u) => u.hostname === "www.notion.so" || u.hostname === "notion.so",
    argMapper: urlToNotionArgs,
  },
  {
    server: "github-mcp",
    tool: "get_file_contents",
    note: "Real tool name on github/github-mcp-server; argMapper maps to {owner, repo, ref, path}.",
    displayPattern: "https://github.com/*/*/blob/**",
    match: (u) => u.hostname === "github.com" && /\/[^/]+\/[^/]+\/blob\//.test(u.pathname),
    argMapper: urlToGithubBlobArgs,
  },
];

export function findRoute(rawUrl: string): RouteEntry | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const p of PATTERNS) {
    if (p.match(u)) {
      return {
        server: p.server,
        tool: p.tool,
        argMapper: p.argMapper,
        ...(p.note ? { note: p.note } : {}),
      };
    }
  }
  return null;
}

export function _listPatterns(): readonly RouteEntry[] {
  return PATTERNS;
}
