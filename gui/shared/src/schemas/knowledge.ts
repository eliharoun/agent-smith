import { z } from "zod";
import { Platform } from "./agents";

// ─── Source discriminated union ──────────────────────────────────────────
// Targeted parity with src/core/knowledge/schema.ts (CLI source of truth).
// Deliberate deviations from CLI strictness (kept permissive so the GUI
// accepts valid-but-loose bundles authored by real users):
//   - `id` is `string().min(1)`, not kebab-regex.
//   - `delivery` is optional, not required.
//   - No numeric caps on inlineBudgetTokens / maxPages / maxResults.
//   - No URL-format / extractor-pairing superRefine.
// `.strict()` IS applied so unknown-field drift surfaces as test failures.

const Materializer = z.enum([
  "markdown",
  "text",
  "pdf-extract",
  "html-to-md",
  "json",
  "passthrough",
]);
const Extractor = z.enum(["pdf-parse", "mupdf"]);
const RefreshTtlString = z.enum(["1h", "1d", "1w", "never"]);
const RefreshMode = z.enum(["install", "ttl", "session", "always"]);
const RefreshObject = z
  .object({
    mode: RefreshMode,
    ttl: z
      .string()
      .regex(/^\d+(s|m|h|d|w)$/, "ttl must be like '30m', '2h', '1d'")
      .optional(),
    timeout: z.number().int().positive().max(60).optional(),
  })
  .strict();
const Refresh = z.union([RefreshTtlString, RefreshObject]);

const ConfluencePageRef = z.union([
  z.string().min(1),
  z.object({ id: z.number().int().positive() }).strict(),
]);

// v2.0+ knowledge-compiler fields. Mirror src/core/knowledge/schema.ts
// `RetrievalSpec` and the per-source `summary`/`toc`/`retrieval` additions on
// `BaseFields`. Permissive parity (no superRefine here) — the CLI's strict
// validator is the source of truth.
const RetrievalSpec = z
  .object({
    mode: z.enum(["off", "bm25", "external-mcp"]),
    mcpUrl: z.string().url().optional(),
  })
  .strict();

// v1.2 routed-fetch declaration. Mirror src/core/knowledge/schema.ts `ViaSpec`.
// Permissive parity (no credential-key denylist superRefine here) — the CLI's
// strict validator is the source of truth. `.strict()` IS applied so unknown
// keys in `via` surface as drift.
const Via = z
  .object({
    server: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
    allowWriteTool: z.boolean().optional(),
  })
  .strict();

const SourceBase = z.object({
  id: z.string().min(1),
  delivery: z.enum(["inline", "file", "auto"]).optional(),
  description: z.string().optional(),
  optional: z.boolean().optional(),
  inlineBudgetTokens: z.number().int().positive().optional(),
  materialize: Materializer.optional(),
  extractor: Extractor.optional(),
  refresh: Refresh.optional(),
  // v2.0+ compile-stage fields.
  summary: z.string().min(1).max(280).optional(),
  toc: z.boolean().optional(),
  retrieval: RetrievalSpec.optional(),
  // v1.2 routing
  via: Via.optional(),
  // v1.2 forward-compat: Phase 2 will activate this. Phase 1 accepts and
  // no-ops to keep bundles authored against the design doc parseable.
  lazy: z.union([z.boolean(), z.literal("auto")]).optional(),
});

const FileSrc = SourceBase.extend({
  type: z.literal("file"),
  path: z.string().min(1),
}).strict();
const DirSrc = SourceBase.extend({
  type: z.literal("dir"),
  path: z.string().min(1),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).strict();
const GlobSrc = SourceBase.extend({
  type: z.literal("glob"),
  path: z.string().min(1),
}).strict();
const UrlSrc = SourceBase.extend({
  type: z.literal("url"),
  url: z.string().url(),
  auth: z.enum(["atlassian", "none"]).optional(),
}).strict();
const GitSrc = SourceBase.extend({
  type: z.literal("git"),
  url: z.string().min(1),
  subpath: z.string().optional(),
  ref: z.string().optional(),
  include: z.array(z.string()).optional(),
}).strict();
const NpmSrc = SourceBase.extend({
  type: z.literal("npm"),
  package: z.string().min(1),
}).strict();
const ConfluenceSrc = SourceBase.extend({
  type: z.literal("confluence"),
  space: z.string().min(1),
  pages: z.array(ConfluencePageRef).optional(),
  maxPages: z.number().int().positive().optional(),
  includeChildren: z.boolean().optional(),
  format: z.enum(["storage", "view", "markdown"]).optional(),
}).strict();
const JiraSrc = SourceBase.extend({
  type: z.literal("jira"),
  jql: z.string().min(1),
  fields: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().optional(),
}).strict();

export const KnowledgeSource = z.discriminatedUnion("type", [
  FileSrc,
  DirSrc,
  GlobSrc,
  UrlSrc,
  GitSrc,
  NpmSrc,
  ConfluenceSrc,
  JiraSrc,
]);
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const KnowledgeSourceType = z.enum([
  "file",
  "dir",
  "glob",
  "url",
  "git",
  "npm",
  "confluence",
  "jira",
]);
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceType>;

// ─── Materialized manifest (`<home>/knowledge/<agent>/_manifest.json`) ──
export const ManifestFile = z.object({
  path: z.string(),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  summary: z.string().optional(),
});
export const ManifestSourceEntry = z.object({
  id: z.string(),
  scope: z.string().optional(),
  type: KnowledgeSourceType,
  source: z
    .object({
      url: z.string().optional(),
      path: z.string().optional(),
      ref: z.string().optional(),
      resolvedSha: z.string().optional(),
    })
    .partial()
    .optional(),
  delivery: z.enum(["inline", "file", "auto"]).optional(),
  files: z.array(ManifestFile),
  fetchedAt: z.string().optional(),
  extractor: z.string().nullable().optional(),
  tokensInline: z.number().int().nonnegative(),
  description: z.string().optional(),
});
export const KnowledgeManifest = z.object({
  schemaVersion: z.literal(1),
  renderedAt: z.string(),
  sources: z.array(ManifestSourceEntry),
  totals: z.object({
    tokensInline: z.number().int().nonnegative(),
    tokensInlineBudget: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
});
export type KnowledgeManifest = z.infer<typeof KnowledgeManifest>;

// ─── Per-source refresh cache `*.meta.json` ─────────────────────────────
export const RefreshCacheEntry = z.object({
  last_refreshed_at: z.string(),
  last_attempt_at: z.string(),
  last_error: z.string().nullable(),
  etag: z.string().optional(),
  last_modified: z.string().optional(),
});
export type RefreshCacheEntry = z.infer<typeof RefreshCacheEntry>;

// ─── Refresh-consent manifest (`<home>/refresh/<agent>/refresh-manifest.json`) ─
export const RefreshConsentManifest = z.object({
  agent: z.string().min(1),
  refresh_consent: z.object({
    granted_at: z.string(),
    platforms: z.array(Platform),
    sources: z.array(z.string().min(1)),
  }),
});
export type RefreshConsentManifest = z.infer<typeof RefreshConsentManifest>;

// ─── Joined view returned by `GET /api/knowledge/:agent` ────────────────
export const SourceJoined = z.object({
  source: KnowledgeSource,
  // Materialized manifest entry for this source, if rendered.
  manifestEntry: ManifestSourceEntry.optional(),
  // Per-source refresh-cache file, if present.
  refreshCache: RefreshCacheEntry.optional(),
});
export type SourceJoined = z.infer<typeof SourceJoined>;

export const AgentKnowledgeView = z.object({
  agent: z.string(),
  sources: z.array(SourceJoined),
  totals: KnowledgeManifest.shape.totals.optional(),
  consent: RefreshConsentManifest.shape.refresh_consent.optional(),
});
export type AgentKnowledgeView = z.infer<typeof AgentKnowledgeView>;

// ─── URL-shortcut parser response ───────────────────────────────────────
export const ParsedKnowledgeUrl = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confluence-page"),
    space: z.string(),
    pageId: z.string(),
    title: z.string().optional(),
  }),
  z.object({
    kind: z.literal("confluence-blog"),
    space: z.string(),
    postId: z.string(),
    title: z.string().optional(),
  }),
  z.object({ kind: z.literal("confluence-space"), space: z.string() }),
  z.object({ kind: z.literal("jira-issue"), key: z.string() }),
  z.object({ kind: z.literal("jira-jql"), jql: z.string() }),
  z.object({ kind: z.literal("plain-url"), url: z.string().url() }),
]);
export type ParsedKnowledgeUrl = z.infer<typeof ParsedKnowledgeUrl>;

// ─── Bulk refresh summary (GET /api/knowledge/refresh-summary) ──────────
export const RefreshSummary = z.object({
  agent: z.string().min(1),
  lastRefreshAt: z.string().optional(),
  sourceCount: z.number().int().nonnegative(),
  failingCount: z.number().int().nonnegative(),
});
export type RefreshSummary = z.infer<typeof RefreshSummary>;

// ─── MCP server/tool picker (GET /api/agents/:name/mcp-servers-and-tools) ─
//
// Mirrors the CLI's `pickViaInteractively` (src/cli/commands/knowledge/pick-via.ts):
// the union of bundle-declared mcpServers[] and servers smith finds in the
// user's AI client configs, plus per-server URL-shaped tools (filtered via
// `detectUrlParam`). The Add Knowledge Source modal feeds the response into
// two dropdowns — server then tool — and writes the resulting `via:` block
// onto the new source.
const McpServerSource = z.enum(["bundle", "available", "both"]);
export type McpServerSource = z.infer<typeof McpServerSource>;

const McpUrlParamKind = z.enum(["string", "string-array"]);
export type McpUrlParamKind = z.infer<typeof McpUrlParamKind>;

export const McpUrlShapedTool = z.object({
  name: z.string().min(1),
  urlParam: z
    .object({
      kind: McpUrlParamKind,
      key: z.string().min(1),
    })
    .nullable(),
});
export type McpUrlShapedTool = z.infer<typeof McpUrlShapedTool>;

export const McpServerAndToolsView = z.object({
  servers: z.array(
    z.object({
      name: z.string().min(1),
      source: McpServerSource,
      /** Populated when smith couldn't spawn or list tools on this server. */
      error: z.string().optional(),
    }),
  ),
  /** Map of server name → URL-shaped tools. Servers with `error` are absent here. */
  toolsByServer: z.record(z.string(), z.array(McpUrlShapedTool)),
});
export type McpServerAndToolsView = z.infer<typeof McpServerAndToolsView>;
