import type { FieldHelpEntry } from "./index";

/**
 * Help text for every knowledge-source field surfaced by the GUI's
 * Add/Edit modals. Keyed by canonical paths matching the on-disk
 * `agent.config.json#knowledge` shape.
 *
 * Style rules:
 *   - 1–3 sentences, plain English, ≤ 280 chars (matches schema summary cap).
 *   - No marketing prose. Explain WHAT it does + WHEN to use it.
 *   - Use \n to separate logical paragraphs; the Tooltip preserves whitespace.
 */
export const knowledgeHelp: Record<string, FieldHelpEntry> = {
  "knowledge.id": {
    help: "Stable identifier for this source. Used in the compiled TOC and as the on-disk path under sources/<id>/. Kebab-case.",
  },
  "knowledge.type": {
    help: "How smith fetches this source. file/dir/glob read from local disk; webpage/url/git/confluence/jira fetch from external systems; web crawls or parses manifests; mcp connects to an MCP server.",
  },
  "knowledge.path": {
    help: "Path on disk (file/dir/glob types). Relative paths resolve against the bundle directory.",
  },
  "knowledge.url": {
    help: "URL to fetch (url/git types). Cached on first install; refreshed per the refresh mode below.",
  },
  "knowledge.include": {
    help: "Glob patterns to include. One per line. Filters which files inside a directory or repo end up materialized.",
  },
  "knowledge.exclude": {
    help: "Glob patterns to exclude. One per line. Applied after include.",
  },
  "knowledge.description": {
    help: "Human-readable note shown in `smith knowledge list`. Optional.",
  },
  "knowledge.delivery": {
    help: "How the source's content reaches the agent.\ninline = embed in system prompt (always-resident; small bundles).\nfile = sidecar the agent reads on demand (large bundles).\nauto = smith picks based on size.",
  },
  "knowledge.summary": {
    help: "One-line summary shown in the compiled TOC. Falls back to description, then to id. Max 280 chars.",
  },
  "knowledge.toc": {
    help: "Whether to include this source in the compiled `## Knowledge` TOC. Default yes; turn off for sources you want compiled to disk but not advertised in the prompt.",
  },
  "knowledge.retrieval.mode": {
    help: "How agents search this source.\nbm25 (default): in-memory BM25 index; adds search hint to TOC.\nexternal-mcp: delegate to a remote MCP server.\noff: advisory (source still indexed locally, but no TOC annotation).",
  },
  "knowledge.retrieval.mcpUrl": {
    help: "URL of the external retrieval MCP server. Required when mode is `external-mcp`. Today this lands in the compiled TOC as a routing hint; runtime delegation lands in a future smith release.",
  },
  "knowledge.materialize": {
    help: "How raw fetched content is converted before storage. markdown / text / html-to-md / json / passthrough. Default depends on type. (`pdf-extract` is reserved but not yet supported.)",
  },
  "knowledge.refresh.mode": {
    help: "When smith re-fetches this source.\ninstall = only at install time (default; correct for static file/dir/glob).\nttl = polled by the daemon when cache age exceeds the ttl.\nsession = refetched at every agent session start.\nalways = install AND every session start.",
  },
  "knowledge.refresh.ttl": {
    help: "Cache TTL when mode is `ttl`. Format: number + unit, e.g. `30m`, `2h`, `1d`.",
  },
  "knowledge.refresh.timeout": {
    help: "Per-source fetch budget in seconds. Default 5, max 60.",
  },
  "knowledge.optional": {
    help: "When on, fetch errors degrade to warnings instead of aborting `smith agent install`. Use for sources that may be temporarily unreachable but aren't load-bearing.",
  },
  "knowledge.inlineBudgetTokens": {
    help: "Per-source cap on inline content size, 1–16000 tokens. Falls back to the bundle-wide `inlineBudget.totalTokens` (default 8000).",
  },
  // ─── Type-specific extras ─────────────────────────────────────────────
  "knowledge.git.ref": {
    help: "Git ref to check out: branch name, tag, or commit SHA. Defaults to the repo's default branch.",
  },
  "knowledge.git.subpath": {
    help: "Restrict the clone to a subdirectory of the repo. Useful when only a docs/ subtree is interesting.",
  },
  "knowledge.url.auth": {
    help: "Auth scheme for URL fetches. `atlassian` injects the Atlassian token from .env; `none` sends an unauthenticated request.",
  },
  "knowledge.npm.package": {
    help: "npm package name (with optional @scope). smith fetches the latest published tarball and materializes its files.",
  },
  "knowledge.confluence.space": {
    help: "Confluence space key (e.g. `ENG`). Required even when also providing page IDs.",
  },
  "knowledge.confluence.pages": {
    help: "Specific Confluence pages to fetch. One per line. Numeric page IDs go as `id:12345`; titles or paths can be used directly.",
  },
  "knowledge.confluence.maxPages": {
    help: "Cap on pages fetched from a Confluence space. 1–100. Stops the crawl early to limit bundle size.",
  },
  "knowledge.confluence.includeChildren": {
    help: "When on, also fetch child pages of any specified page. Off by default.",
  },
  "knowledge.confluence.format": {
    help: "Body format requested from the Confluence API. markdown (preferred), storage (raw XHTML), or view (rendered HTML).",
  },
  "knowledge.jira.jql": {
    help: "JQL query that selects Jira issues. e.g. `project = ENG AND updated >= -30d`.",
  },
  "knowledge.jira.fields": {
    help: "Comma-separated list of issue fields to materialize. e.g. `summary,status,priority`. Default = a sensible subset.",
  },
  "knowledge.jira.maxResults": {
    help: "Cap on issues fetched per JQL run. 1–500. Limits bundle size and API quota.",
  },
  // ─── Web (crawl / llms-txt / openapi) ─────────────────────────────────
  "knowledge.webpage.url": {
    help: "URL of the page to fetch. Must start with https://. Used by the webpage source type (single-page fetch).",
  },
  "knowledge.web.url": {
    help: "Start URL for the web source. For crawl: the page to crawl from. For llms-txt: the /llms.txt manifest URL. For openapi: the spec URL (JSON or YAML).",
  },
  "knowledge.web.mode": {
    help: "Crawl strategy. crawl = follow links from the start URL; llms-txt = fetch the site's llms.txt manifest; openapi = fetch an OpenAPI/Swagger spec.",
  },
  "knowledge.web.maxPages": {
    help: "Maximum number of pages to crawl. Only applies when mode is crawl. 1–200, default 25.",
  },
  "knowledge.web.depth": {
    help: "Maximum link-follow depth from the start URL. Only applies when mode is crawl. 0 = start page only.",
  },
  "knowledge.web.sameOrigin": {
    help: "When on, the crawler stays on the same origin as the start URL. On by default — only same-origin links are followed.",
  },
  // ─── MCP source ────────────────────────────────────────────────────────
  "knowledge.mcp.server": {
    help: "Name of the MCP server to connect to (must match a server declared in the bundle's mcpServers[] or the AI client config).",
  },
  "knowledge.mcp.tool": {
    help: "Tool name exposed by the MCP server to call for fetching content (e.g. search_pages, search_code).",
  },
  "knowledge.mcp.args": {
    help: "JSON object of extra arguments passed to the MCP tool on every invocation. Optional.",
  },
  "knowledge.mcp.preset": {
    help: "Shortcut that pre-fills server + tool from a known integration (notion, github, slack). You can override the values after selecting.",
  },
  "knowledge.mcp.allowWriteTool": {
    help: "When on, allows the MCP tool to perform write operations. Off by default — only read-only tools are permitted.",
  },
};
