/** Source acquisition type. Supported: file/dir/glob/url/git/confluence/jira. npm declared but rejected by validator (acquire impl pending). */
export type KnowledgeSourceType =
  | "file"
  | "dir"
  | "glob"
  | "url"
  | "git"
  | "npm"
  | "confluence"
  | "jira";

/** Materializer choice. Supported: passthrough/markdown/text/html-to-md/json. pdf-extract declared but rejected (extractor pending). */
export type Materializer =
  | "markdown"
  | "text"
  | "pdf-extract"
  | "html-to-md"
  | "json"
  | "passthrough";

/** PDF extractor. Forward-compat: pdf-extract materializer not yet wired (validator rejects). See docs/superpowers/specs/2026-05-03-agent-knowledge-sources-design.md §10 for design. */
export type PdfExtractor = "pdf-parse" | "mupdf";

/** Delivery mode. */
export type KnowledgeDelivery = "inline" | "file" | "auto";

/** Refresh mode for a knowledge source.
 *  - `install`: materialized at `smith agent install` only (default; today's behavior)
 *  - `ttl`: refreshed by the daemon when cache age exceeds the declared `ttl`
 *  - `session`: refreshed at every agent session start by the platform hook
 *  - `always`: install ∪ session (refreshed at install AND every session start)
 */
export type RefreshMode = "install" | "ttl" | "session" | "always";

/** Legacy TTL shorthand. Kept for back-compat with v0.14 knowledge.yml files.
 *  When seen, `parseRefresh` normalizes "1h"/"1d"/"1w" → { mode: "ttl", ttl: <value> }
 *  and "never" → { mode: "install" }.
 */
export type RefreshTtl = "1h" | "1d" | "1w" | "never";

/** Per-source refresh declaration. Object form unlocks the new modes;
 *  string form (RefreshTtl) is back-compat shorthand. */
export type RefreshSpec = RefreshTtl | NormalizedRefresh;

/** Normalized form returned by parseRefresh — always an object, always has mode. */
export interface NormalizedRefresh {
  mode: RefreshMode;
  /** Required when mode === "ttl". Format: number + unit (s|m|h|d|w), e.g. "30m", "2h", "1d". */
  ttl?: string;
  /** Computed by parseRefresh from `ttl`. Always present in practice when
   *  `mode === "ttl"` (parseRefresh derives it whenever `ttl` is set), but
   *  declared optional so callers can construct NormalizedRefresh literals
   *  (e.g. validator pass-through, defaults) without re-deriving it. The
   *  daemon TTL refresh loop reads this to compare against cache age. */
  ttlMs?: number;
  /** Per-source fetch budget in seconds; soft-clamped to global session budget. Default 5. */
  timeout?: number;
}

/** Auth provider for url sources. */
export type KnowledgeAuth = "atlassian" | "none";

/** v2.0 compile-stage retrieval mode for the optional MCP server. */
export type RetrievalMode = "off" | "bm25" | "external-mcp";

/** v2.0 compile-stage per-source retrieval declaration. */
export interface RetrievalSpec {
  mode: RetrievalMode;
  /** Required when mode === "external-mcp". */
  mcpUrl?: string;
}

/** Confluence page body format. */
export type ConfluenceFormat = "storage" | "view" | "markdown";

/** Confluence page reference: title (string) or { id }. */
export type ConfluencePageRef = string | { id: number };

interface KnowledgeSourceBase {
  id: string;
  delivery: KnowledgeDelivery;
  materialize?: Materializer;
  extractor?: PdfExtractor;
  inlineBudgetTokens?: number;
  refresh?: RefreshSpec;
  description?: string;
  /** When true, acquire/materialize errors of ANY type become warnings
   *  instead of errors and the source is omitted from the manifest.
   *  Bundle-config validation happens at load time (Zod), not here. */
  optional?: boolean;
  /** v2.0: TOC line override; falls back to description, then computed summary. */
  summary?: string;
  /** v2.0: include in the compiled TOC stanza (default true when compile.progressive). */
  toc?: boolean;
  /** v2.0: per-source retrieval mode for the optional MCP server. */
  retrieval?: RetrievalSpec;
  /** v1.2: optional MCP routing override. When set, smith calls
   *  `via.server.via.tool(args)` at acquire/refresh time instead of (or
   *  in addition to) the type-specific acquirer. See `Via` below. */
  via?: Via;
}

export interface FileSource extends KnowledgeSourceBase {
  type: "file";
  path: string;
}
export interface DirSource extends KnowledgeSourceBase {
  type: "dir";
  path: string;
  include?: string[];
  exclude?: string[];
}
export interface GlobSource extends KnowledgeSourceBase {
  type: "glob";
  path: string;
}
export interface UrlSource extends KnowledgeSourceBase {
  type: "url";
  url: string;
  auth?: KnowledgeAuth;
}
export interface GitSource extends KnowledgeSourceBase {
  type: "git";
  url: string;
  subpath?: string;
  ref?: string;
  include?: string[];
}
export interface NpmSource extends KnowledgeSourceBase {
  type: "npm";
  package: string;
}
export interface ConfluenceSource extends KnowledgeSourceBase {
  type: "confluence";
  space: string;
  pages?: ConfluencePageRef[];
  maxPages?: number;
  includeChildren?: boolean;
  format?: ConfluenceFormat;
}
export interface JiraSource extends KnowledgeSourceBase {
  type: "jira";
  jql: string;
  fields?: string[];
  maxResults?: number;
}

export type KnowledgeSource =
  | FileSource
  | DirSource
  | GlobSource
  | UrlSource
  | GitSource
  | NpmSource
  | ConfluenceSource
  | JiraSource;

export interface KnowledgeInlineBudget {
  totalTokens: number;
}

/** v2.0 compile-stage options. When omitted on a `KnowledgeBlock`, the
 *  pipeline runs in v1 mode and produces no `CompiledKnowledge`. */
export interface CompileOptions {
  progressive: boolean;
  tocMaxLines: number;
  emitAgentsMd: boolean;
}

export interface KnowledgeBlock {
  packs?: string[];
  inlineBudget?: KnowledgeInlineBudget;
  sources?: KnowledgeSource[];
  /** v2.0 compile stage. When omitted, pipeline runs in v1 mode. */
  compile?: CompileOptions;
}

/** What the assembler needs to render the prompt sections. */
export interface KnowledgeSection {
  inline: { id: string; description?: string; content: string }[];
  index: { id: string; relPath: string; description?: string; summary?: string }[];
  /**
   * Absolute path to the per-agent knowledge directory the `index` entries are relative to.
   * Threaded into the rendered "Knowledge Index" preamble so the assistant has a literal,
   * unambiguous file path to pass to its `Read` tool and never has to guess. Optional for
   * back-compat with callers that build a `KnowledgeSection` without one (notably tests
   * and any in-memory-only callers); the assembler degrades to relative-path-only when
   * absent.
   */
  rootDir?: string;
  /**
   * True when the section has at least one `type: git` knowledge source. The
   * assembler uses this to decide whether to render the `repos/<source-id>/`
   * paragraph in the Knowledge Index preamble. Optional for back-compat: when
   * absent, the assembler treats it as `false`.
   */
  hasGitSources?: boolean;
  /**
   * Set of knowledge source types present in this section (e.g., `"jira"`,
   * `"confluence"`). The assembler uses this together with the agent's
   * `skills[]` to decide whether to emit a `## Tool Routing Policy` block.
   * Optional for back-compat: when absent, the assembler treats it as empty
   * and emits no routing policy.
   */
  sourceTypes?: Set<KnowledgeSourceType>;
}

export type KnowledgeScope = "pack" | "agent" | "project";

/** A single materialized file inside a source's output dir. */
export interface MaterializedFile {
  /** Path relative to the agent's `knowledge/` dir, e.g. `sources/stripe-api/index.md`. */
  relPath: string;
  bytes: number;
  sha256: string;
  /** First heading or first 200 chars; one-line. */
  summary?: string;
}

/** A source after acquire+materialize, ready to be written to disk and indexed in the manifest. */
export interface MaterializedSource {
  id: string;
  scope: KnowledgeScope;
  type: KnowledgeSourceType;
  delivery: KnowledgeDelivery;
  description?: string;
  files: MaterializedFile[];
  /** Tokens consumed if delivery=inline; 0 otherwise. */
  tokensInline: number;
  /** Inline content (only set when delivery=inline). */
  content?: string;
  /** Provenance for manifest. */
  source?: { url?: string; path?: string; ref?: string; resolvedSha?: string };
  /** ISO 8601. */
  fetchedAt?: string;
  /** v2.0: TOC line override; falls back to description, then computed summary. */
  summary?: string;
  /** v2.0: include in the compiled TOC stanza (default true when compile.progressive). */
  toc?: boolean;
  /** v2.0: per-source retrieval mode for the optional MCP server. */
  retrieval?: RetrievalSpec;
}

export interface KnowledgeManifestSourceEntry {
  id: string;
  scope: KnowledgeScope;
  type: KnowledgeSourceType;
  source?: { url?: string; path?: string; ref?: string; resolvedSha?: string };
  delivery: KnowledgeDelivery;
  files: { path: string; sha256: string; bytes: number; summary?: string }[];
  fetchedAt?: string;
  extractor?: PdfExtractor | null;
  tokensInline: number;
  description?: string;
  /** v2.0: TOC line override; falls back to description, then computed summary. */
  summary?: string;
  /** v2.0: include in the compiled TOC stanza (default true when compile.progressive). */
  toc?: boolean;
  /** v2.0: per-source retrieval mode for the optional MCP server. */
  retrieval?: RetrievalSpec;
}

export interface KnowledgeManifest {
  schemaVersion: 1;
  renderedAt: string;
  sources: KnowledgeManifestSourceEntry[];
  totals: {
    tokensInline: number;
    tokensInlineBudget: number;
    files: number;
    bytes: number;
  };
}

/**
 * v1.2 routing spec. When present, smith routes acquire/refresh-time
 * fetches through the named MCP server's tool instead of (or in addition
 * to) the type-specific acquirer. Args, when present, pass verbatim to
 * tools/call. Credential-shaped arg keys are rejected at schema level.
 */
export interface Via {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  allowWriteTool?: boolean;
}
