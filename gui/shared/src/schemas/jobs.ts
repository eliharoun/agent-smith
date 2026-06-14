import { z } from "zod";
import { Platform } from "./agents";

const ConsentValue = z.enum(["yes", "no", "skip"]);

// C4: git ref used by external-repo installs (defense-in-depth against
// option-injection — the CLI also validates via validateRef).
const RefString = z
  .string()
  .min(1)
  .refine((s) => !s.startsWith("-"), { message: "ref must not start with '-'" })
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  .refine((s) => !/[;|`$\n\r\u0000-\u001f\u007f]/.test(s), {
    message: "ref contains forbidden character",
  });

const Init = z.object({ command: z.literal("init") });
const InitUser = z.object({ command: z.literal("init-user") });
const Status = z.object({ command: z.literal("status") });
const Doctor = z.object({
  command: z.literal("doctor"),
  json: z.boolean().optional(),
  fixKnowledgeRefresh: z.boolean().default(false),
  fixKnowledgeCompile: z.boolean().default(false),
  fixKnowledgeIndex: z.boolean().default(false),
  fixMcpCommands: z.boolean().default(false),
});
const AgentList = z.object({ command: z.literal("agent.list") });
const AgentInit = z.object({
  command: z.literal("agent.init"),
  name: z.string().min(1),
  description: z
    .string()
    .min(10, "description must be at least 10 characters")
    .max(200, "description must be at most 200 characters"),
  template: z.string().optional(),
});
const AgentValidate = z.object({
  command: z.literal("agent.validate"),
  name: z.string().min(1),
});
const AgentInstall = z
  .object({
    command: z.literal("agent.install"),
    // name + platforms are optional when `from` is set: the CLI derives the
    // bundle name from --from and prompts for platforms via SSE. The .refine()
    // below enforces "either from OR (name + at least one platform)".
    name: z.string().min(1).optional(),
    platforms: z.array(Platform).default([]),
    withSkills: z.boolean().default(false),
    // zod 4: partialRecord allows a subset of keys from the enum (vs z.record which requires all)
    refreshConsent: z.partialRecord(Platform, ConsentValue).optional(),
    // C4: external-repo install
    from: z.string().min(1).optional(),
    ref: RefString.optional(),
    // Task 1.5: bypass would-clobber refusal when a non-smith file occupies
    // the destination. Threaded through to `installRendered` via the CLI's
    // `--force` flag.
    force: z.boolean().optional(),
    // Task 4: allow install even when a target platform CLI is missing
    allowMissingCli: z.boolean().optional(),
    // Task 6: multi-select install from external repo
    agents: z.array(z.string().min(1)).optional(),
    all: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.from) || (Boolean(v.name) && v.platforms.length > 0), {
    message: "either `from` OR both `name` and at least one platform must be set",
    path: ["from"],
  })
  .refine((v) => !((v.agents?.length ?? 0) > 0 || v.all || v.json) || Boolean(v.from), {
    message: "`agents`, `all`, and `json` require `from`",
    path: ["from"],
  });
// .strict() guards against legacy callers passing refreshConsent (removed; CLI never accepted it).
const AgentInstallAll = z
  .object({
    command: z.literal("agent.install-all"),
    platforms: z.array(Platform).min(1),
    withSkills: z.boolean().default(false),
    force: z.boolean().optional(),
    allowMissingCli: z.boolean().optional(),
  })
  .strict();
const AgentUninstall = z.object({
  command: z.literal("agent.uninstall"),
  name: z.string().min(1),
  platforms: z.array(Platform).min(1),
  // Task 1.5: bypass manifest hash-mismatch refusal when smith-installed
  // files have been modified externally.
  force: z.boolean().optional(),
});
const AgentUninstallAll = z.object({
  command: z.literal("agent.uninstall-all"),
  platforms: z.array(Platform).min(1),
  force: z.boolean().optional(),
});
const AgentReconfigure = z.object({
  command: z.literal("agent.reconfigure"),
  name: z.string().min(1),
  grant: z.array(Platform).default([]),
  revoke: z.array(Platform).default([]),
});
const AgentDestroy = z
  .object({
    command: z.literal("agent.destroy"),
    name: z.string().min(1),
    confirmName: z.string().min(1),
    // When true, the CLI chains `uninstall` + `destroy` in the correct
    // order under the `agent:<name>` lock. Required when the agent is
    // currently installed on at least one platform — without it the CLI
    // refuses to delete the source while rendered files would remain
    // pointing at nothing (orphan-file guard, mirrors CLI Task 4).
    force: z.boolean().optional(),
  })
  .refine((v) => v.name === v.confirmName, {
    message: "confirmName must equal name",
    path: ["confirmName"],
  });

const AgentExport = z
  .object({
    command: z.literal("agent.export"),
    name: z.string().min(1),
    to: z.string().min(1).default("."),
    includeSkills: z.boolean().default(true),
    userMd: z.enum(["stub", "keep", "reject"]).default("stub"),
    compression: z.enum(["gzip", "none"]).default("gzip"),
    json: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    stdout: z.boolean().default(false),
    // Directory mode (default "archive" preserves prior behavior).
    format: z.enum(["archive", "directory"]).default("archive"),
    withReadme: z.boolean().default(false),
    noManifest: z.boolean().default(false),
    force: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !(v.format === "directory" && v.stdout), {
    message: "--format directory cannot be combined with --stdout",
    path: ["stdout"],
  })
  .refine((v) => !(v.format === "directory" && v.compression === "none"), {
    // --compression is meaningless in directory mode; reject explicitly so
    // the GUI surfaces a clear error rather than silently dropping the flag.
    message: "--compression has no effect in directory mode",
    path: ["compression"],
  });

// ─── Skill commands ───────────────────────────────────────────────────────

const SkillKind = z.enum(["user-global", "user-local", "team-shared"]);

const SkillRegister = z.object({
  command: z.literal("skill.register"),
  path: z.string().min(1),
  kind: SkillKind,
  label: z.string().min(1).optional(),
  gitRemote: z.url().optional(),
  allowEmpty: z.boolean().default(false),
  skipGitCheck: z.boolean().default(false),
});

const SkillUnregister = z.object({
  command: z.literal("skill.unregister"),
  // CLI accepts either a path-shaped input (absolute, ./-prefixed, or
  // containing a /) or a bare label. Disambiguation is the CLI's job.
  pathOrLabel: z.string().min(1),
});

const SkillList = z.object({
  command: z.literal("skill.list"),
  all: z.boolean().default(false),
});

const SkillCatalogs = z.object({ command: z.literal("skill.catalogs") });

const SkillCatalogRename = z
  .object({
    command: z.literal("skill.catalog-rename"),
    oldLabel: z.string().min(1),
    newLabel: z.string().min(1),
  })
  .refine((v) => v.oldLabel !== v.newLabel, {
    message: "newLabel must differ from oldLabel",
    path: ["newLabel"],
  });

const SkillBootstrap = z.object({
  command: z.literal("skill.bootstrap"),
  dryRun: z.boolean().default(false),
  // Empty array = all three platforms (matches the CLI default when --targets
  // is omitted). Callers that want to restrict pass a non-empty subset.
  targets: z.array(Platform).default([]),
});

const SkillInstall = z
  .object({
    command: z.literal("skill.install"),
    // Either `name` (catalog/name reference) OR `from` (path) must be set, not both.
    name: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    as: z.string().min(1).optional(),
    targets: z.array(Platform).default([]),
    // C4.2.2: external-repo install ref (only meaningful when `from` is set;
    // CLI ignores it for catalog/name installs).
    ref: RefString.optional(),
    // Task 6: multi-select install from external repo
    skills: z.array(z.string().min(1)).optional(),
    all: z.boolean().optional(),
    json: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.name) !== Boolean(v.from), {
    message: "exactly one of `name` or `from` must be provided",
    path: ["name"],
  })
  .refine((v) => !((v.skills?.length ?? 0) > 0 || v.all || v.json) || Boolean(v.from), {
    message: "`skills`, `all`, and `json` require `from`",
    path: ["from"],
  })
  .refine((v) => !(Boolean(v.name) && ((v.skills?.length ?? 0) > 0 || v.all)), {
    message: "`name` cannot be combined with `skills`/`all`",
    path: ["name"],
  });

const SkillUpdate = z
  .object({
    command: z.literal("skill.update"),
    name: z.string().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.name) !== v.all, {
    message: "provide `name` OR set `all: true`, not both",
    path: ["name"],
  });

const SkillUninstall = z.object({
  command: z.literal("skill.uninstall"),
  name: z.string().min(1),
});

// Agent catalog commands

const AgentCatalogKind = z.enum(["user-global", "project", "registered"]);

const AgentRegister = z.object({
  command: z.literal("agent.register"),
  path: z.string().min(1),
  kind: AgentCatalogKind,
  label: z.string().min(1).optional(),
  gitRemote: z.url().optional(),
  allowEmpty: z.boolean().default(false),
  skipGitCheck: z.boolean().default(false),
});

const AgentUnregister = z.object({
  command: z.literal("agent.unregister"),
  pathOrLabel: z.string().min(1),
});

const AgentCatalogs = z.object({ command: z.literal("agent.catalogs") });

const AgentCatalogRename = z
  .object({
    command: z.literal("agent.catalog-rename"),
    oldLabel: z.string().min(1),
    newLabel: z.string().min(1),
  })
  .refine((v) => v.oldLabel !== v.newLabel, {
    message: "newLabel must differ from oldLabel",
    path: ["newLabel"],
  });

// Knowledge commands

const KnowledgeAdd = z.object({
  command: z.literal("knowledge.add"),
  agent: z.string().min(1),
  // First positional: either a knowledge type ("file"|"dir"|"glob"|"url"|"git"|
  // "npm"|"confluence"|"jira"|"webpage"|"web"|"mcp") or an http(s) URL (URL-shortcut form).
  typeOrUrl: z.string().min(1),
  // Second positional, required UNLESS typeOrUrl is an http(s) URL. The
  // CLI does the actual cross-field validation when the job runs; we
  // intentionally don't refine() here because well-formed URL-shortcut
  // requests would otherwise reject before the CLI sees them.
  pathOrUrl: z.string().optional(),
  id: z.string().min(1).optional(),
  delivery: z.enum(["inline", "file", "auto"]).optional(),
  description: z.string().optional(),
  optional: z.boolean().default(false),
  install: z.boolean().default(true), // false → CLI receives --no-install
  // Confluence-only:
  pages: z.string().optional(), // CSV passed straight through to the CLI
  maxPages: z.number().int().positive().optional(),
  includeChildren: z.boolean().default(false),
  format: z.enum(["storage", "view", "markdown"]).optional(),
  // Jira-only:
  fields: z.string().optional(),
  maxResults: z.number().int().positive().optional(),
  // URL-only: when true, smith records the URL + description but does not
  // fetch at install time. The CLI's own validator rejects --lazy on
  // non-URL types; the GUI omits this field for non-URL forms.
  lazy: z.boolean().optional(),
  // Web-only (type "web"):
  mode: z.enum(["crawl", "llms-txt", "openapi"]).optional(),
  maxPagesWeb: z.number().int().positive().optional(),
  depth: z.number().int().positive().optional(),
  sameOrigin: z.boolean().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  // MCP-only (type "mcp"):
  server: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  preset: z.string().optional(),
  allowWriteTool: z.boolean().optional(),
});

const KnowledgeRemove = z.object({
  command: z.literal("knowledge.remove"),
  agent: z.string().min(1),
  sourceId: z.string().min(1),
});

const KnowledgeList = z.object({
  command: z.literal("knowledge.list"),
  agent: z.string().min(1),
  json: z.boolean().default(true), // GUI consumers always want JSON
});

const KnowledgeFetch = z.object({
  command: z.literal("knowledge.fetch"),
  agent: z.string().min(1),
  source: z.string().min(1).optional(),
});

const KnowledgeValidate = z.object({
  command: z.literal("knowledge.validate"),
  agent: z.string().min(1).optional(),
});

// T11: progressive-compile MCP plumbing. `compile` builds the per-bundle
// BM25 index + manifest; `serve` exposes it over MCP stdio. Both target a
// single bundle by `name` (mirroring the CLI's `<name>` positional). We
// don't refine `name XOR all` because the CLI already emits a friendly
// usage error and the schema stays permissive — same convention as the
// other knowledge.* shapes above (knowledge.list/fetch/validate).
const KnowledgeCompile = z.object({
  command: z.literal("knowledge.compile"),
  name: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

const KnowledgeServe = z.object({
  command: z.literal("knowledge.serve"),
  name: z.string().min(1),
});

// ─── Daemon, update, jack-out, migration ──────────────────────────────────

const DaemonStart = z.object({
  command: z.literal("daemon.start"),
  // GUI-only convenience: when the env-tuning form saves, the GUI passes
  // the new values here so the spawned daemon picks them up immediately
  // without re-sourcing the persisted .env. Keys are documented in
  // services/smith-env.ts.
  envOverrides: z.record(z.string(), z.string()).optional(),
});
const DaemonStop = z.object({ command: z.literal("daemon.stop") });

const Update = z.object({
  command: z.literal("update"),
  dryRun: z.boolean().default(false),
});

const JackOut = z
  .object({
    command: z.literal("jack-out"),
    // Mirrors the CLI's prompt literal in src/cli/commands/jack-out.ts:201.
    confirmPhrase: z.string(),
  })
  .refine((v) => v.confirmPhrase === "jack-out", {
    message: 'confirmPhrase must equal "jack-out"',
    path: ["confirmPhrase"],
  });

const KnowledgeMigrateCodex = z.object({
  command: z.literal("knowledge.migrate-codex"),
  path: z.string().optional(),
});

const SkillValidate = z.object({
  command: z.literal("skill.validate"),
  name: z.string().min(1),
});

// C4.2.3: external-repo sync commands. Both look up the bundle by registry
// name, derive the clone path from the stored remote{} block, and run a
// fast-forward fetch + checkout via the CLI (`smith agent sync` /
// `smith skill sync`). The CLI emits SSE progress events and a final
// `done` event with the new lastPulledSha.
const AgentSync = z.object({
  command: z.literal("agent.sync"),
  name: z.string().min(1),
});
const SkillSync = z.object({
  command: z.literal("skill.sync"),
  name: z.string().min(1),
});

export const JobRequest = z.discriminatedUnion("command", [
  Init,
  InitUser,
  Status,
  Doctor,
  AgentList,
  AgentInit,
  AgentValidate,
  AgentInstall,
  AgentInstallAll,
  AgentUninstall,
  AgentUninstallAll,
  AgentReconfigure,
  AgentDestroy,
  AgentExport,
  // skills
  SkillRegister,
  SkillUnregister,
  SkillList,
  SkillCatalogs,
  SkillCatalogRename,
  SkillBootstrap,
  SkillInstall,
  SkillUpdate,
  SkillUninstall,
  // agent catalogs
  AgentRegister,
  AgentUnregister,
  AgentCatalogs,
  AgentCatalogRename,
  // knowledge
  KnowledgeAdd,
  KnowledgeRemove,
  KnowledgeList,
  KnowledgeFetch,
  KnowledgeValidate,
  // progressive compile + MCP serve
  KnowledgeCompile,
  KnowledgeServe,
  // daemon, update, jack-out, codex migration
  DaemonStart,
  DaemonStop,
  Update,
  JackOut,
  KnowledgeMigrateCodex,
  SkillValidate,
  // C4.2.3: external-repo sync
  AgentSync,
  SkillSync,
]);

export type JobRequest = z.infer<typeof JobRequest>;
export type JobCommand = JobRequest["command"];
