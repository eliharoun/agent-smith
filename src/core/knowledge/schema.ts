import { z } from "zod";
import { KEBAB } from "../kebab";

const KnowledgeDelivery = z.enum(["inline", "file", "auto"]);
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
// Refresh object: `timeout` is the per-source fetch budget cap. The runtime
// default is 5s (see refresh-spec.ts:DEFAULT_TIMEOUT_SECONDS) and the global
// session wall-clock is also 5s; the schema cap of 60s is an absolute upper
// bound to catch typos like `timeout: 600` while still permitting override
// for slow sources during ad-hoc (non-session) refreshes.
const RefreshObject = z
  .object({
    mode: RefreshMode,
    ttl: z.string().regex(/^\d+(s|m|h|d|w)$/, "ttl must be like '30m', '2h', '1d'").optional(),
    timeout: z.number().int().positive().max(60).optional(),
  })
  .strict();
const Refresh = z.union([RefreshTtlString, RefreshObject]);
const Auth = z.enum(["atlassian", "none"]);
const ConfluenceFormat = z.enum(["storage", "view", "markdown"]);
const ConfluencePageRef = z.union([
  z.string().min(1),
  z.object({ id: z.number().int().positive() }),
]);

// v1.2 routing: when set, smith calls <server>.<tool>(args) instead of HTTP
// at acquire/refresh time. Travels with the bundle so recipients route the
// same way. Credential-shaped argument keys are rejected at schema level —
// authors must not bake auth into shared bundles.
export const CREDENTIAL_KEY_DENYLIST = /(authorization|bearer|cookie|credential|password|passwd|secret|token|(^|[_-])(api|access|private|secret)[_-]?key($|[_-])|apikey)/i;

const ViaSpec = z
  .object({
    server: z.string().min(1, "via.server must be non-empty"),
    tool: z.string().min(1, "via.tool must be non-empty"),
    args: z.record(z.string(), z.unknown()).optional()
      .superRefine((args, ctx) => {
        if (!args) return;
        for (const key of Object.keys(args)) {
          if (CREDENTIAL_KEY_DENYLIST.test(key)) {
            ctx.addIssue({
              code: "custom",
              message: `via.args key '${key}' looks credential-shaped — credentials must not travel with shared bundles. Use the MCP server's own auth instead.`,
              path: [key],
            });
          }
        }
      }),
    /** Opt-out of the read-shaped tool-name guard. Authors must opt in
     *  explicitly to call write/destructive tools via routing. */
    allowWriteTool: z.boolean().optional(),
  })
  .strict();

// v2.0 compile-stage retrieval spec. `external-mcp` requires `mcpUrl`.
const RetrievalMode = z.enum(["off", "bm25", "external-mcp"]);
const RetrievalSpec = z
  .object({
    mode: RetrievalMode,
    mcpUrl: z.string().url().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.mode === "external-mcp" && !r.mcpUrl) {
      ctx.addIssue({
        code: "custom",
        message: "retrieval.mode='external-mcp' requires mcpUrl",
        path: ["mcpUrl"],
      });
    }
  });

// Shared base fields. Every variant extends this.
const BaseFields = {
  id: z.string().regex(KEBAB, "id must be kebab-case"),
  delivery: KnowledgeDelivery,
  materialize: Materializer.optional(),
  extractor: Extractor.optional(),
  inlineBudgetTokens: z.number().int().positive().max(16000).optional(),
  refresh: Refresh.optional(),
  description: z.string().optional(),
  optional: z.boolean().optional(),
  // v2.0 (compile stage)
  summary: z.string().min(1).max(280).optional(),
  toc: z.boolean().optional(),
  retrieval: RetrievalSpec.optional(),
  // v1.2 routing
  via: ViaSpec.optional(),
} as const;

// Per-variant strict schemas. `.strict()` rejects unknown keys so cross-type
// foreign fields (e.g. `space` on type=file) are structurally rejected with a
// message that includes the field name (Zod emits `Unrecognized key: "<name>"`).
// Required variant fields (e.g. `path` on type=file) are required at the schema
// level so the inferred output matches the TS variant interface exactly.
const FileVariant = z
  .object({
    ...BaseFields,
    type: z.literal("file"),
    path: z.string({ message: "type=file requires path" }),
  })
  .strict();
const DirVariant = z
  .object({
    ...BaseFields,
    type: z.literal("dir"),
    path: z.string({ message: "type=dir requires path" }),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();
const GlobVariant = z
  .object({
    ...BaseFields,
    type: z.literal("glob"),
    path: z.string({ message: "type=glob requires path" }),
  })
  .strict();
// Webpage sources (formerly "url") can be either lazy (no install-time fetch;
// agent fetches at runtime) or eager (existing v1 behavior, fetched at install).
//
// When lazy=true, the delivery decision doesn't apply (lazy supersedes
// delivery), and materialize/extractor/inlineBudgetTokens are nonsensical
// since no body is fetched at install. Those fields are forbidden via a
// superRefine below. When lazy is unset or false, delivery is required.
//
// We keep a single ZodObject for the Webpage variant (rather than a nested
// union) so the outer `discriminatedUnion("type", ...)` still works:
// zod 4's discriminatedUnion forbids two options sharing the same
// discriminator value and rejects nested unions wholesale.
const WebpageVariant = z
  .object({
    // `delivery` is optional at the schema level; the refinement below
    // requires it for non-lazy webpage sources and forbids it for lazy ones.
    id: BaseFields.id,
    delivery: BaseFields.delivery.optional(),
    materialize: BaseFields.materialize,
    extractor: BaseFields.extractor,
    inlineBudgetTokens: BaseFields.inlineBudgetTokens,
    refresh: BaseFields.refresh,
    description: BaseFields.description,
    optional: BaseFields.optional,
    summary: BaseFields.summary,
    toc: BaseFields.toc,
    retrieval: BaseFields.retrieval,
    via: BaseFields.via,
    type: z.literal("webpage"),
    url: z.string({ message: "type=webpage requires url" }).min(1),
    auth: Auth.optional(),
    lazy: z.boolean().optional(),
  })
  .strict()
  .superRefine((src, ctx) => {
    if (src.lazy === true) {
      // Lazy webpage forbids install-time fetch knobs.
      for (const k of ["delivery", "materialize", "extractor", "inlineBudgetTokens"] as const) {
        if (src[k] !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `${k} is not allowed when lazy: true (lazy webpage sources are fetched at runtime, not install)`,
            path: [k],
          });
        }
      }
    } else if (src.delivery === undefined) {
      // Eager webpage still requires delivery (v1 behavior).
      ctx.addIssue({
        code: "custom",
        message: "delivery is required for non-lazy webpage sources",
        path: ["delivery"],
      });
    }
  });
const WebVariant = z
  .object({
    ...BaseFields,
    type: z.literal("web"),
    url: z.string({ message: "type=web requires url" }).min(1),
    mode: z.enum(["crawl", "llms-txt", "openapi"]),
    maxPages: z.number().int().min(1).max(200).optional(),
    depth: z.number().int().min(1).max(5).optional(),
    sameOrigin: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((src, ctx) => {
    if (src.mode !== "crawl") {
      for (const k of ["maxPages", "depth", "sameOrigin", "include", "exclude"] as const) {
        if (src[k] !== undefined) {
          ctx.addIssue({ code: "custom", message: `${k} is only valid when mode=crawl (mode=${src.mode} ignores it)`, path: [k] });
        }
      }
    }
  });
const McpVariant = z.object({ ...BaseFields, type: z.literal("mcp"), server: z.string().min(1, "type=mcp requires server"), tool: z.string().min(1, "type=mcp requires tool"),
  args: z.record(z.string(), z.unknown()).optional()
    .superRefine((args, ctx) => {
      if (!args) return;
      for (const key of Object.keys(args)) {
        if (CREDENTIAL_KEY_DENYLIST.test(key)) {
          ctx.addIssue({
            code: "custom",
            message: `mcp.args key '${key}' looks credential-shaped — credentials must not travel with shared bundles. Use the MCP server's own auth instead.`,
            path: [key],
          });
        }
      }
    }),
  preset: z.string().min(1).optional(), allowWriteTool: z.boolean().optional() }).strict();
const GitVariant = z
  .object({
    ...BaseFields,
    type: z.literal("git"),
    url: z.string({ message: "type=git requires url" }).min(1),
    subpath: z.string().optional(),
    ref: z.string().optional(),
    include: z.array(z.string()).optional(),
  })
  .strict();
const NpmVariant = z
  .object({
    ...BaseFields,
    type: z.literal("npm"),
    package: z.string({ message: "type=npm requires package" }),
  })
  .strict();
const ConfluenceVariant = z
  .object({
    ...BaseFields,
    type: z.literal("confluence"),
    space: z.string({ message: "type=confluence requires space" }).min(1),
    pages: z.array(ConfluencePageRef).optional(),
    maxPages: z.number().int().min(1).max(100).optional(),
    includeChildren: z.boolean().optional(),
    format: ConfluenceFormat.optional(),
  })
  .strict();
const JiraVariant = z
  .object({
    ...BaseFields,
    type: z.literal("jira"),
    jql: z.string({ message: "type=jira requires jql" }).min(1),
    fields: z.array(z.string().min(1)).optional(),
    maxResults: z.number().int().min(1).max(500).optional(),
  })
  .strict();

// Discriminated union: structurally rejects foreign fields per-variant and
// requires per-variant fields. URL-format and extractor-pairing checks live in
// the wrapping superRefine below since they cross fields within a variant.
export const KnowledgeSourceSchema = z
  .discriminatedUnion("type", [
    FileVariant,
    DirVariant,
    GlobVariant,
    WebpageVariant,
    WebVariant,
    GitVariant,
    NpmVariant,
    ConfluenceVariant,
    JiraVariant,
    McpVariant,
  ])
  .superRefine((src, ctx) => {
    // URL format checks (variant-aware: type=webpage and type=web are strict
    // RFC, type=git also accepts SCP-style ssh shorthand `git@host:path`).
    if ((src.type === "webpage" || src.type === "web" || src.type === "git") && "url" in src && (src as { url?: string }).url) {
      const url = (src as { url: string }).url;
      const isRfcUrl = (() => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      })();
      const isScpGit = /^[\w.-]+@[\w.-]+:.+/.test(url);
      if ((src.type === "webpage" || src.type === "web") && !isRfcUrl) {
        ctx.addIssue({
          code: "custom",
          message: `type=${src.type} requires a valid URL (https://, http://, etc.)`,
          path: ["url"],
        });
      }
      if (src.type === "git" && !isRfcUrl && !isScpGit) {
        ctx.addIssue({
          code: "custom",
          message:
            "type=git requires a git URL (https://..., ssh://..., or git@host:path)",
          path: ["url"],
        });
      }
    }
    // extractor only meaningful when materialize=pdf-extract.
    if (src.extractor && src.materialize !== "pdf-extract") {
      ctx.addIssue({
        code: "custom",
        message: "extractor only valid when materialize=pdf-extract",
        path: ["extractor"],
      });
    }
  });

// v2.0 compile-stage block. When `progressive: true`, the pipeline emits a
// CompiledKnowledge { tocStanza, manifest } in addition to the v1 outputs.
const CompileBlock = z
  .object({
    progressive: z.boolean().default(true),
    tocMaxLines: z.number().int().positive().max(400).default(150),
    emitAgentsMd: z.boolean().default(false),
  })
  .strict();

export const KnowledgeBlockSchema = z.object({
  packs: z.array(z.string().regex(KEBAB, "pack name must be kebab-case")).optional(),
  inlineBudget: z
    .object({ totalTokens: z.number().int().positive().max(16000) })
    .optional(),
  sources: z.array(KnowledgeSourceSchema).optional(),
  compile: CompileBlock.optional(),
});
