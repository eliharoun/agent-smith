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
const UrlVariant = z
  .object({
    ...BaseFields,
    type: z.literal("url"),
    url: z.string({ message: "type=url requires url" }).min(1),
    auth: Auth.optional(),
  })
  .strict();
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
    UrlVariant,
    GitVariant,
    NpmVariant,
    ConfluenceVariant,
    JiraVariant,
  ])
  .superRefine((src, ctx) => {
    // URL format checks (variant-aware: type=url is strict RFC, type=git
    // also accepts SCP-style ssh shorthand `git@host:path`).
    if ((src.type === "url" || src.type === "git") && src.url) {
      const isRfcUrl = (() => {
        try {
          new URL(src.url);
          return true;
        } catch {
          return false;
        }
      })();
      const isScpGit = /^[\w.-]+@[\w.-]+:.+/.test(src.url);
      if (src.type === "url" && !isRfcUrl) {
        ctx.addIssue({
          code: "custom",
          message: "type=url requires a valid URL (https://, http://, etc.)",
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
