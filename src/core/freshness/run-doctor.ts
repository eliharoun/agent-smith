import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { type GitRunner, sniffPath, verifyGitRemote } from "../../cli/registry-validation";
import {
  type AtlassianAuth,
  resolveAtlassianAuth as defaultResolveAtlassianAuth,
  resolveAtlassianBaseUrl as defaultResolveAtlassianBaseUrl,
} from "../../io/atlassian-auth";
import { detectBridgeDrift } from "../../io/atlassian-bridge";
import {
  hashSkillDir as defaultHashSkillDir,
  loadInstalledSkills as defaultLoadInstalledSkills,
  type InstalledSkill,
  type InstalledSkillsFile,
} from "../../io/installed-skills";
import {
  hashContent as defaultHashContent,
  loadInstalledAgents as defaultLoadInstalledAgents,
  type InstalledAgentsFile,
} from "../../io/installed-agents";
import {
  detectPython as defaultDetectPython,
  type PythonRuntimeStatus,
} from "../../io/python-runtime";
import { loadRegistry } from "../../io/registry";
import { diffRequiredSkills, type RequiredSkillEntry } from "../../io/required-skills";
import { loadSkillRegistry } from "../../io/skill-registry";
import { stateHome } from "../../io/state-home";
import {
  checkWorkspaceVersion as defaultCheckWorkspaceVersion,
  resolveWorkspacePath as defaultResolveWorkspacePath,
  type WorkspaceVersionStatus,
} from "../../io/workspace-version";
import { redactSecrets } from "../redact";
import { SmithError } from "../smith-error";
import { resolveOpenCodeModel } from "../model-resolution/opencode";
import { sortByOpenCodePrecedence } from "../model-resolution/provider-table";
import { detectAllPlatforms } from "../../io/auth";
import type { PlatformAuth, PlatformAuthMatrix } from "../../io/auth/types";
import { detectAuthenticatedProviders as defaultDetectAuthProviders } from "../../io/opencode-auth";
import { resolveClaudeCodeModel } from "../model-resolution/claude-code";
import { resolveCodexModel } from "../model-resolution/codex";
import { resolveKiroModel } from "../model-resolution/kiro";
import { toMessage } from "../to-message";
import { isCacheFresh } from "./cache";
import {
  type CheckKnowledgeConsistencyInput,
  checkKnowledgeConsistency,
  type KnowledgeConsistencyReport,
} from "./check-knowledge-consistency";
import {
  type CheckRefreshHooksInput,
  checkRefreshHooks,
  type RefreshHooksReport,
} from "./check-refresh-hooks";
import {
  type CheckKnowledgeCompileInput,
  checkKnowledgeCompile,
  type KnowledgeCompileReport,
} from "./check-knowledge-compile";
import {
  checkMcpSpawnCommands,
  type CheckMcpSpawnInput,
  type McpSpawnSection,
} from "./check-mcp-spawn";
import {
  checkMcpDeps,
  type CheckMcpDepsOpts,
  type McpDepFinding,
} from "./check-mcp-deps";
import {
  checkLazyFetch,
  type CheckLazyFetchOpts,
  type LazyFetchFinding,
} from "./check-lazy-fetch";
import {
  checkUrlRouting,
  type CheckUrlRoutingOpts,
  type CheckUrlRoutingResult,
} from "./check-url-routing";
import { diffSchemas } from "./diff";
import { checkDuplicateCatalogs, type DuplicateCatalogsReport } from "./duplicate-catalogs";
import type { InstalledModelsPaths } from "./installed-models";
import { scanInstalledModels } from "./installed-models";
import { checkRemoteCatalogs, type RemoteCatalogsReport } from "./remote-catalogs";
import type {
  AgentDriftEntry,
  AgentDriftReport,
  AgentRequiredSkillsReport,
  AtlassianAuthReport,
  AtlassianSkillsRuntimeStatus,
  DoctorDeps,
  DoctorPlatformReport,
  DoctorReport,
  ModelResolutionReport,
  PlatformId,
  RegistryHygieneReport,
  SchemaMeta,
  SkillDriftEntry,
  SkillDriftReport,
  ToolMapMeta,
} from "./types";

// Note: per-agent MCP availability checking is implemented in
// `src/io/mcp-availability.ts` and consumed at install time by
// `src/io/orchestrator.ts`. It is intentionally NOT wired into doctor:
// MCP availability is a property of the *target platform's* current
// configuration, not of the workspace, so it sits at install time
// where the per-platform target is known. If a future requirement
// adds an `smith doctor`-time MCP scan, re-derive from
// `src/io/mcp-availability.ts`.

export type DoctorSectionId =
  | "opencode"
  | "claude-code"
  | "codex"
  | "kiro"
  | "model-resolution"
  | "workspace"
  | "atlassian-auth"
  | "skill-drift"
  | "agent-drift"
  | "agent-required-skills"
  | "registry-hygiene"
  | "remote-catalogs"
  | "duplicate-catalogs"
  | "knowledge-refresh"
  | "knowledge-compile"
  | "mcp-spawn-commands"
  | "mcp-deps"
  | "lazy-fetch"
  | "url-routing"
  | "knowledge-prompt-disk-consistency";

export interface DoctorSectionStartEvent {
  id: DoctorSectionId;
  /** Human-readable label (e.g. "OpenCode schema"). */
  label: string;
}

export interface DoctorSectionDoneEvent {
  id: DoctorSectionId;
  status: "ok" | "warn" | "error" | "skipped";
  /** One-line summary suitable for ora's `.succeed()/.warn()/.fail()/.info()`. */
  summary: string;
}

/**
 * Per-section data captured during a doctor run for downstream human-output
 * renderers (formatReportCompact, formatFailuresOnly). Mirrors the union of
 * fields from DoctorSectionStartEvent.label + DoctorSectionDoneEvent.{status,summary}.
 * Captured by the CLI layer via the onSectionStart + onSectionDone callbacks.
 */
export interface CapturedSectionSummary {
  id: DoctorSectionId;
  label: string;
  status: DoctorSectionDoneEvent["status"];
  summary: string;
}

export interface RunDoctorInput {
  vendoredSchema: Record<string, unknown>;
  schemaMeta: SchemaMeta;
  claudeMeta: ToolMapMeta;
  codexMeta: ToolMapMeta;
  /**
   * Kiro tool-map provenance (data/kiro-tool-map.json _meta block). Optional
   * for back-compat — when omitted the kiro section is skipped entirely.
   * Production callers (`smith doctor` CLI) always pass this.
   */
  kiroMeta?: ToolMapMeta;
  deps: DoctorDeps;
  /**
   * Optional gating set of platform IDs whose CLI was detected on PATH.
   * When omitted, all three platforms are treated as installed (back-compat
   * with existing callers and tests). When provided, platforms NOT in the
   * set are skipped: their {@link DoctorPlatformReport} is omitted from
   * {@link DoctorReport.platforms} and the platform id is appended to
   * {@link DoctorReport.skippedPlatforms}. The CLI populates this from
   * {@link detectInstalledPlatforms}.
   */
  installedPlatforms?: Set<PlatformId>;
  /** Optional. If omitted, modelResolution section is skipped. */
  modelResolution?: {
    getOpenCodeModels: () => Promise<string[] | undefined>;
    findOpencodeOnPath: () => Promise<string | null>;
    installedPaths: InstalledModelsPaths;
    curatedFallback: { high: string; balanced: string; fast: string };
    /** Detect authenticated providers. Defaults to opencode-auth.detectAuthenticatedProviders. */
    detectAuthenticatedProviders?: () => Promise<string[]>;
    /** Read .env file contents for provider preference detection. */
    readEnvFile?: () => Record<string, string>;
    /**
     * Per-platform auth matrix. When provided, the doctor uses these
     * directly; when omitted, it calls `detectAllPlatforms()` from
     * `src/io/auth/`. Tests inject fakes; the CLI passes the live result.
     */
    platformAuth?: PlatformAuthMatrix;
  };
  /**
   * Optional. If omitted, no progress events are emitted (back-compat: pure
   * orchestrator behavior identical to before).
   */
  onSectionStart?: (event: DoctorSectionStartEvent) => void;
  onSectionDone?: (event: DoctorSectionDoneEvent) => void;
  /**
   * Optional. If omitted, workspace section is skipped entirely (no entry
   * in {@link DoctorReport.workspace}). Used by `smith doctor`.
   */
  workspace?: {
    /** The `import.meta.url` of the running entry point. Passed to resolveWorkspacePath. */
    importMetaUrl: string;
    /** When true, returns `{ status: "unknown", reason: "offline-skipped" }` without git ls-remote. */
    offline: boolean;
    /** Optional override for testing; defaults to the real checkWorkspaceVersion. */
    check?: (cwd: string) => Promise<WorkspaceVersionStatus>;
    /** Optional override for testing; defaults to the real resolveWorkspacePath. */
    resolve?: (importMetaUrl: string) => Promise<string | null>;
  };
  /**
   * Optional. If omitted, defaults to the real resolver. Tests inject a stub.
   * When the resolver returns null, the section reports `missing`; otherwise
   * `configured` with the resolved source.
   */
  resolveAtlassianAuth?: () => AtlassianAuth | null;
  /**
   * v0.14: true when any registered agent declares a `confluence`/`jira`
   * knowledge source. Combined with `atlassian-skills` installed, gates the
   * Atlassian-auth section's relevance. Default false (back-compat).
   */
  hasAtlassianKnowledgeSources?: boolean;
  /**
   * Optional override mirroring `resolveAtlassianAuth`. Defaults to the
   * production helper. Used by `checkAtlassianAuth` to detect the
   * "auth resolved but no workspace URL" incomplete state.
   */
  resolveAtlassianBaseUrl?: () => string | null;
  /**
   * Optional. Test seam for Python runtime detection in the atlassian-auth
   * section. Defaults to the real `detectPython()`.
   */
  detectPython?: () => Promise<PythonRuntimeStatus>;
  /**
   * Optional. Test seam for loading installed skills in the atlassian-auth
   * section. Defaults to the real `loadInstalledSkills()`.
   */
  loadInstalledSkillsForAuth?: () => Promise<InstalledSkillsFile>;
  /**
   * Optional. Test seam for reading the .env file as a flat key-value map
   * for bridge-drift detection. Defaults to reading `<stateHome>/.env`.
   */
  readEnvForBridge?: () => Promise<Record<string, string>>;
  /**
   * Optional. If omitted, the skill-drift section is skipped entirely (no
   * entry in {@link DoctorReport.skillDrift}). When provided, runs after
   * atlassian-auth and reports per-installed-skill content-hash status.
   *
   * `loadInstalled` and `hashDir` default to the real implementations; tests
   * inject stubs to keep the section hermetic. `homeDir` is forwarded to the
   * loader (so tests can point at a temp dir without touching real \$HOME).
   */
  skillDrift?: {
    homeDir?: string;
    loadInstalled?: (opts?: { homeDir?: string }) => Promise<InstalledSkillsFile>;
    hashDir?: (path: string) => Promise<string>;
    /**
     * Returns true if the path exists and is a directory; false otherwise.
     * Defaults to a node:fs/promises stat() probe. Test seam.
     */
    pathExists?: (path: string) => Promise<boolean>;
  };
  /**
   * Optional. If omitted, the agent-drift section is skipped. When provided,
   * classifies each installed-agent entry as ok | drift | missing.
   * Informational only — never affects exitCode.
   */
  agentDrift?: {
    homeDir?: string;
    loadInstalled?: (opts?: { homeDir?: string }) => Promise<InstalledAgentsFile>;
    hashFile?: (path: string) => Promise<string>;
    pathExists?: (path: string) => Promise<boolean>;
  };
  /**
   * Optional. When provided (non-null/undefined return) the agent-required-skills
   * section runs. Returns the agents to inspect (subset of fields needed). Each
   * agent's `requires.skills` is diffed against {@link loadInstalledSkillNames}
   * to build the report.
   */
  loadAgentsForDoctor?: () => Promise<
    Array<{ name: string; requires?: { skills?: RequiredSkillEntry[] } }>
  >;
  /**
   * Optional. Required-skills section uses this to determine which skills are
   * currently installed. Defaults to reading installed-skills.json names.
   */
  loadInstalledSkillNames?: () => Promise<string[]>;
  /**
   * Optional. If omitted, defaults to the real `loadInstalledSkills`
   * against the user's home dir.
   */
  readInstalledSkills?: () => Promise<InstalledSkillsFile>;
  /**
   * Optional registry hygiene config. If omitted, the section is
   * skipped entirely. When provided, walks both registries and runs
   * sniffPath/verifyGitRemote checks. Protected skill catalogs are
   * exempt from hygiene checks since their rootPath may not exist
   * on a fresh checkout.
   */
  registryHygiene?: {
    registryPath: string;
    skillRegistryPath: string;
    runGit: GitRunner;
  };
  /**
   * Optional remote-catalogs freshness check (v1-task C3.14). Walks both
   * registries and reports drift (lastPulledSha vs lastRemoteSha) and
   * stale check-in timestamps. Offline-safe — no network IO. Requires
   * the same registry paths as {@link registryHygiene}. Independent
   * input field so callers can opt in to one without the other.
   */
  remoteCatalogs?: {
    registryPath: string;
    skillRegistryPath: string;
    /** Test seam — defaults to `new Date()` at section-run time. */
    now?: () => Date;
    /** Optional override for the staleness threshold (ms). Default 7 days. */
    stalenessMs?: number;
  };
  /**
   * Optional duplicate-catalogs check (v1-task RC2-10). When provided,
   * walks both registries and groups entries by normalized git URL;
   * reports clusters of size >= 2 so users can clean up accidental
   * duplicates left over from rc.1 (when install --from didn't refuse
   * them). Independent of registryHygiene / remoteCatalogs so callers
   * can opt in granularly. Offline-safe — no IO beyond reading the
   * registry files.
   */
  duplicateCatalogs?: {
    registryPath: string;
    skillRegistryPath: string;
  };
  /**
   * Optional knowledge-refresh detection. When provided, runs the
   * read-only drift check defined in
   * {@link "./check-refresh-hooks".checkRefreshHooks}. Repair
   * (`--fix-knowledge-refresh`) is the responsibility of a later task and
   * is intentionally NOT wired into this orchestrator yet.
   */
  knowledgeRefresh?: CheckRefreshHooksInput;
  /**
   * Optional knowledge-compile detection. When provided, runs the
   * read-only drift check defined in
   * {@link "./check-knowledge-compile".checkKnowledgeCompile}. For each
   * candidate (a registered agent with `knowledge.compile.progressive=true`),
   * it compares the persisted `compile-manifest.json` against a fresh
   * `compile()` over the agent's existing materialized sources. Repair
   * (`--fix-knowledge-compile`) is wired in the CLI layer.
   */
  knowledgeCompile?: CheckKnowledgeCompileInput;
  /**
   * Optional mcp-spawn-commands audit. When provided, walks each platform's
   * MCP config and flags non-absolute `command` fields (the v2.1 GUI toggle
   * legacy state — bare `"smith"` that fails to spawn under
   * Spotlight/dock-launched GUIs). Detection is read-only; repair is wired
   * by the CLI's `--fix-mcp-commands` flag.
   */
  mcpSpawnCommands?: CheckMcpSpawnInput;
  /**
   * Optional mcp-deps audit. When provided, walks each installed agent's
   * `mcp.required[]` / `mcp.peer[]` declarations and reports server names
   * absent from the union of platform MCP configs. Read-only; no repair.
   * The CLI builds {@link CheckMcpDepsOpts} from `loadAllBundles` and the
   * platform MCP-config readers; tests inject in-memory stubs so the
   * section never touches `~/.claude.json` or any real config file.
   */
  mcpDeps?: CheckMcpDepsOpts;
  /**
   * Optional lazy-fetch audit. When provided, walks each bundle's lazy URL
   * sources and reports any that lack a runtime fetch path (no via routing
   * AND no target with a built-in fetch tool, or via routing to an MCP
   * server that isn't installed on any platform). Read-only; no repair.
   * Informational only — never affects {@link DoctorReport.exitCode}. The
   * CLI builds {@link CheckLazyFetchOpts} from `loadAllBundles` and the
   * platform MCP-config readers; tests inject in-memory stubs so the
   * section never touches real config files.
   */
  lazyFetch?: CheckLazyFetchOpts;
  /**
   * Optional url-routing summary. When provided, walks the three routing
   * layers (curated registry, advertised `_meta` claims, user cache) and
   * emits the merged routing table plus any ambiguity findings. Read-only;
   * informational only — never affects {@link DoctorReport.exitCode}. The
   * CLI provides default loaders that read the user cache and discover
   * `_meta` claims by spawning each available MCP server; tests inject
   * in-memory stubs so the section never touches real state.
   */
  urlRouting?: CheckUrlRoutingOpts;
  /**
   * Optional knowledge-prompt-disk-consistency check. When provided, verifies
   * that Knowledge Index bullets in rendered prompts resolve to existing files,
   * repos/ symlinks are valid, and manifest entries match disk.
   */
  knowledgeConsistency?: CheckKnowledgeConsistencyInput;
}

/**
 * Pure orchestrator for the freshness check. All I/O is injected via `deps`
 * (fetch, fs, clock). Returns a {@link DoctorReport} with a literal exit code:
 * 0 = no drift / offline-skipped, 1 = OpenCode drift or stale installed agent, 2 = network error.
 *
 * Optionally emits per-section start/done events via `onSectionStart` /
 * `onSectionDone` for streaming UIs (ora spinners). Sections still run
 * sequentially in the same order as before; concurrency is a separate concern.
 *
 * The workspace section is informational; its status never affects
 * {@link DoctorReport.exitCode}. Specifically, `unknown:network-error` for the
 * workspace section does NOT bump the exit code to 2.
 *
 * Consumed by `src/cli/commands/doctor.ts`, which provides production
 * implementations of {@link DoctorDeps}.
 */
export async function runDoctor(input: RunDoctorInput): Promise<DoctorReport> {
  const { vendoredSchema, schemaMeta, claudeMeta, codexMeta, deps } = input;
  const generatedAt = deps.now().toISOString();

  // Default to all-three for back-compat with callers that don't yet pass
  // a detected set (existing tests, programmatic consumers). Task 5 will
  // use this to gate section execution; for now it only populates
  // `report.skippedPlatforms`.
  const installedPlatforms =
    input.installedPlatforms ?? new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);
  const ALL_PLATFORMS: PlatformId[] = ["claude-code", "codex", "kiro", "opencode"];
  const skippedPlatforms: PlatformId[] = ALL_PLATFORMS.filter((p) => !installedPlatforms.has(p));

  let opencode: Extract<DoctorPlatformReport, { platform: "opencode" }> | undefined;
  if (installedPlatforms.has("opencode")) {
    emitStart(input, "opencode", "OpenCode schema");
    opencode = await checkOpencode(vendoredSchema, schemaMeta, deps);
    emitDone(input, "opencode", opencodeEventStatus(opencode), opencodeSummary(opencode));
  }

  let claudeCode: DoctorPlatformReport | undefined;
  if (installedPlatforms.has("claude-code")) {
    emitStart(input, "claude-code", "Claude Code tool map");
    claudeCode = manualPlatform("claude-code", claudeMeta);
    emitDone(
      input,
      "claude-code",
      "ok",
      `Claude Code tool map verified ${claudeMeta.lastVerifiedDate}`,
    );
  }

  let codex: DoctorPlatformReport | undefined;
  if (installedPlatforms.has("codex")) {
    emitStart(input, "codex", "Codex tool map");
    codex = manualPlatform("codex", codexMeta);
    emitDone(input, "codex", "ok", `Codex tool map verified ${codexMeta.lastVerifiedDate}`);
  }

  let kiro: DoctorPlatformReport | undefined;
  if (installedPlatforms.has("kiro") && input.kiroMeta) {
    emitStart(input, "kiro", "Kiro tool map");
    kiro = manualPlatform("kiro", input.kiroMeta);
    emitDone(input, "kiro", "ok", `Kiro tool map verified ${input.kiroMeta.lastVerifiedDate}`);
  }

  let modelResolution: ModelResolutionReport | undefined;
  // Model resolution is OpenCode-specific (it probes the opencode binary on
  // PATH and lists agents from the OpenCode install). Skip it entirely when
  // OpenCode isn't installed, even if the caller supplied input.modelResolution.
  if (input.modelResolution && installedPlatforms.has("opencode")) {
    emitStart(input, "model-resolution", "Model resolution");
    modelResolution = await buildModelResolutionReport(input.modelResolution);
    emitDone(
      input,
      "model-resolution",
      modelResolutionEventStatus(modelResolution),
      modelResolutionSummary(modelResolution),
    );
  }

  let workspace: WorkspaceVersionStatus | undefined;
  if (input.workspace) {
    emitStart(input, "workspace", "Workspace version");
    const resolve = input.workspace.resolve ?? defaultResolveWorkspacePath;
    const check = input.workspace.check ?? defaultCheckWorkspaceVersion;
    const path = await resolve(input.workspace.importMetaUrl);
    if (path === null) {
      workspace = { status: "unknown", reason: "no-workspace" };
    } else if (input.workspace.offline) {
      workspace = { status: "unknown", reason: "offline-skipped" };
    } else {
      workspace = await check(path);
    }
    emitDone(input, "workspace", workspaceEventStatus(workspace), workspaceSummary(workspace));
  }

  emitStart(input, "atlassian-auth", "Atlassian auth");
  const atlassianAuth = await checkAtlassianAuth(input);
  emitDone(
    input,
    "atlassian-auth",
    atlassianAuthEventStatus(atlassianAuth),
    atlassianAuthSummary(atlassianAuth),
  );

  let skillDrift: SkillDriftReport | undefined;
  if (input.skillDrift) {
    emitStart(input, "skill-drift", "Installed skills");
    skillDrift = await checkSkillDrift(input.skillDrift);
    emitDone(
      input,
      "skill-drift",
      skillDriftEventStatus(skillDrift),
      skillDriftSummary(skillDrift),
    );
  }

  let agentDrift: AgentDriftReport | undefined;
  if (input.agentDrift) {
    emitStart(input, "agent-drift", "Installed agents");
    agentDrift = await checkAgentDrift(input.agentDrift);
    emitDone(input, "agent-drift", agentDriftEventStatus(agentDrift), agentDriftSummary(agentDrift));
  }

  let agentRequiredSkills: AgentRequiredSkillsReport | undefined;
  if (input.loadAgentsForDoctor) {
    emitStart(input, "agent-required-skills", "Required skills");
    agentRequiredSkills = await checkAgentRequiredSkills(
      input.loadAgentsForDoctor,
      input.loadInstalledSkillNames ?? defaultLoadInstalledSkillNames,
    );
    emitDone(
      input,
      "agent-required-skills",
      agentRequiredSkills.status,
      agentRequiredSkillsSummary(agentRequiredSkills),
    );
  }

  let registryHygiene: RegistryHygieneReport | undefined;
  if (input.registryHygiene) {
    emitStart(input, "registry-hygiene", "Registry hygiene");
    registryHygiene = await checkRegistryHygiene(input.registryHygiene);
    emitDone(
      input,
      "registry-hygiene",
      registryHygieneEventStatus(registryHygiene),
      registryHygieneSummary(registryHygiene),
    );
  }

  let remoteCatalogs: RemoteCatalogsReport | undefined;
  if (input.remoteCatalogs) {
    emitStart(input, "remote-catalogs", "Remote catalogs");
    const reg = await loadRegistry(input.remoteCatalogs.registryPath);
    const skillReg = await loadSkillRegistry(input.remoteCatalogs.skillRegistryPath);
    const now = input.remoteCatalogs.now?.() ?? new Date();
    remoteCatalogs = checkRemoteCatalogs({
      registry: reg,
      skillRegistry: skillReg,
      now,
      ...(input.remoteCatalogs.stalenessMs !== undefined
        ? { stalenessMs: input.remoteCatalogs.stalenessMs }
        : {}),
    });
    emitDone(
      input,
      "remote-catalogs",
      remoteCatalogsEventStatus(remoteCatalogs),
      remoteCatalogsSummary(remoteCatalogs),
    );
  }

  let duplicateCatalogs: DuplicateCatalogsReport | undefined;
  if (input.duplicateCatalogs) {
    emitStart(input, "duplicate-catalogs", "Duplicate catalogs");
    const reg = await loadRegistry(input.duplicateCatalogs.registryPath);
    const skillReg = await loadSkillRegistry(input.duplicateCatalogs.skillRegistryPath);
    duplicateCatalogs = checkDuplicateCatalogs({ registry: reg, skillRegistry: skillReg });
    emitDone(
      input,
      "duplicate-catalogs",
      duplicateCatalogsEventStatus(duplicateCatalogs),
      duplicateCatalogsSummary(duplicateCatalogs),
    );
  }

  let knowledgeRefresh: RefreshHooksReport | undefined;
  if (input.knowledgeRefresh) {
    emitStart(input, "knowledge-refresh", "Knowledge refresh");
    // Narrow the detected PlatformId set (4 values) to RefreshPlatformId
    // (3 values — kiro has no refresh hooks). Inline filter keeps this
    // pure; the underlying check skips kiro anyway via REFRESH_PLATFORMS.
    const refreshInstalled = new Set(
      [...installedPlatforms].filter(
        (p): p is "claude-code" | "codex" | "opencode" =>
          p === "claude-code" || p === "codex" || p === "opencode",
      ),
    );
    knowledgeRefresh = await checkRefreshHooks({
      ...input.knowledgeRefresh,
      installedPlatforms: refreshInstalled,
    });
    emitDone(
      input,
      "knowledge-refresh",
      knowledgeRefreshEventStatus(knowledgeRefresh),
      knowledgeRefreshSummary(knowledgeRefresh),
    );
  }

  let knowledgeCompile: KnowledgeCompileReport | undefined;
  if (input.knowledgeCompile) {
    emitStart(input, "knowledge-compile", "Knowledge compile");
    knowledgeCompile = await checkKnowledgeCompile(input.knowledgeCompile);
    emitDone(
      input,
      "knowledge-compile",
      knowledgeCompileEventStatus(knowledgeCompile),
      knowledgeCompileSummary(knowledgeCompile),
    );
  }

  let mcpSpawnCommands: McpSpawnSection | undefined;
  if (input.mcpSpawnCommands) {
    emitStart(input, "mcp-spawn-commands", "MCP spawn commands");
    mcpSpawnCommands = await checkMcpSpawnCommands({
      ...input.mcpSpawnCommands,
      installedPlatforms,
    });
    emitDone(
      input,
      "mcp-spawn-commands",
      mcpSpawnEventStatus(mcpSpawnCommands),
      mcpSpawnSummary(mcpSpawnCommands),
    );
  }

  let mcpDeps: { findings: McpDepFinding[] } | undefined;
  if (input.mcpDeps) {
    emitStart(input, "mcp-deps", "MCP dependencies");
    const findings = await checkMcpDeps(input.mcpDeps);
    mcpDeps = { findings };
    emitDone(input, "mcp-deps", mcpDepsEventStatus(mcpDeps), mcpDepsSummary(mcpDeps));
  }

  let lazyFetch: { findings: LazyFetchFinding[] } | undefined;
  if (input.lazyFetch) {
    emitStart(input, "lazy-fetch", "Lazy URL fetch");
    const findings = await checkLazyFetch(input.lazyFetch);
    lazyFetch = { findings };
    emitDone(input, "lazy-fetch", lazyFetchEventStatus(lazyFetch), lazyFetchSummary(lazyFetch));
  }

  let urlRouting: CheckUrlRoutingResult | undefined;
  if (input.urlRouting) {
    emitStart(input, "url-routing", "URL routing");
    urlRouting = await checkUrlRouting(input.urlRouting);
    emitDone(input, "url-routing", urlRoutingEventStatus(urlRouting), urlRoutingSummary(urlRouting));
  }

  let knowledgeConsistency: KnowledgeConsistencyReport | undefined;
  if (input.knowledgeConsistency) {
    emitStart(input, "knowledge-prompt-disk-consistency", "Knowledge prompt-disk consistency");
    knowledgeConsistency = await checkKnowledgeConsistency({
      ...input.knowledgeConsistency,
      installedPlatforms,
    });
    emitDone(
      input,
      "knowledge-prompt-disk-consistency",
      knowledgeConsistencyEventStatus(knowledgeConsistency),
      knowledgeConsistencySummary(knowledgeConsistency),
    );
  }

  const baseExitCode: 0 | 1 | 2 = !opencode
    ? 0
    : opencode.status === "drift"
      ? 1
      : opencode.status === "network-error"
        ? 2
        : 0;
  const modelStale = modelResolution?.hasStale === true;
  const exitCode: 0 | 1 | 2 = baseExitCode === 2 ? 2 : modelStale ? 1 : baseExitCode;

  const platforms: DoctorPlatformReport[] = [];
  if (opencode) platforms.push(opencode);
  if (claudeCode) platforms.push(claudeCode);
  if (codex) platforms.push(codex);
  if (kiro) platforms.push(kiro);

  return {
    generatedAt,
    exitCode,
    platforms,
    skippedPlatforms,
    ...(modelResolution ? { modelResolution } : {}),
    ...(workspace ? { workspace } : {}),
    atlassianAuth,
    ...(skillDrift ? { skillDrift } : {}),
    ...(agentDrift ? { agentDrift } : {}),
    ...(agentRequiredSkills ? { agentRequiredSkills } : {}),
    ...(registryHygiene ? { registryHygiene } : {}),
    ...(remoteCatalogs ? { remoteCatalogs } : {}),
    ...(duplicateCatalogs ? { duplicateCatalogs } : {}),
    ...(knowledgeRefresh ? { knowledgeRefresh } : {}),
    ...(knowledgeCompile ? { knowledgeCompile } : {}),
    ...(mcpSpawnCommands ? { mcpSpawnCommands } : {}),
    ...(mcpDeps ? { mcpDeps } : {}),
    ...(lazyFetch ? { lazyFetch } : {}),
    ...(urlRouting ? { urlRouting } : {}),
    ...(knowledgeConsistency ? { knowledgeConsistency } : {}),
  };
}

function emitStart(input: RunDoctorInput, id: DoctorSectionId, label: string): void {
  input.onSectionStart?.({ id, label });
}

function emitDone(
  input: RunDoctorInput,
  id: DoctorSectionId,
  status: DoctorSectionDoneEvent["status"],
  summary: string,
): void {
  input.onSectionDone?.({ id, status, summary });
}

function opencodeEventStatus(
  oc: Extract<DoctorPlatformReport, { platform: "opencode" }>,
): DoctorSectionDoneEvent["status"] {
  switch (oc.status) {
    case "fresh":
      return "ok";
    case "drift":
      return "warn";
    case "network-error":
      return "error";
    case "offline-skipped":
      return "skipped";
  }
}

function opencodeSummary(oc: Extract<DoctorPlatformReport, { platform: "opencode" }>): string {
  switch (oc.status) {
    case "fresh":
      return "OpenCode schema fresh";
    case "drift": {
      const n = oc.drift.added.length + oc.drift.removed.length + oc.drift.changed.length;
      return `OpenCode schema drift detected (${n} change${n === 1 ? "" : "s"})`;
    }
    case "network-error":
      return `OpenCode schema check failed: ${oc.networkError}`;
    case "offline-skipped":
      return "OpenCode schema check skipped (offline)";
  }
}

export function modelResolutionEventStatus(mr: ModelResolutionReport): DoctorSectionDoneEvent["status"] {
  // warn only on user-actionable conditions: an installed agent on a
  // platform that can't run it, or a stale installed agent. Curated-
  // fallback drift is a maintainer concern (the constants ship in the
  // release) — informational, never a user warn.
  const installedPlatforms = new Set(mr.installedAgents.map((a) => a.platform));
  for (const platform of installedPlatforms) {
    const auth = mr.platforms[platform];
    if (auth.status === "unauthenticated" || auth.status === "cli-not-installed") {
      return "warn";
    }
  }
  if (mr.hasStale) return "warn";
  return "ok";
}

function modelResolutionSummary(mr: ModelResolutionReport): string {
  if (mr.liveModelCount === null) {
    return "Model resolution: live model list unavailable";
  }
  const staleAgents = mr.installedAgents.filter(
    (a) => a.platform === "opencode" && a.inLiveList === false,
  ).length;
  const driftedFallbacks = mr.curatedFallbacks.filter((f) => f.inLiveList === false).length;
  if (staleAgents === 0 && driftedFallbacks === 0) {
    return `Model resolution: ${mr.installedAgents.length} installed agent${
      mr.installedAgents.length === 1 ? "" : "s"
    } verified`;
  }
  const parts: string[] = [];
  if (staleAgents > 0) parts.push(`${staleAgents} stale agent${staleAgents === 1 ? "" : "s"}`);
  if (driftedFallbacks > 0)
    parts.push(`${driftedFallbacks} fallback${driftedFallbacks === 1 ? "" : "s"} drifted`);
  return `Model resolution: ${parts.join(", ")}`;
}

function workspaceEventStatus(ws: WorkspaceVersionStatus): DoctorSectionDoneEvent["status"] {
  switch (ws.status) {
    case "current":
    case "ahead":
      return "ok";
    case "behind":
    case "diverged":
      return "warn";
    case "unknown":
      switch (ws.reason) {
        case "offline-skipped":
        case "non-git":
        case "no-workspace":
          return "skipped";
        case "network-error":
        case "empty-remote":
          return "error";
        case "no-local-head":
        case "empty-local-head":
          return "warn";
      }
  }
}

function workspaceSummary(ws: WorkspaceVersionStatus): string {
  switch (ws.status) {
    case "current":
      return "Workspace up to date";
    case "behind":
      return ws.commitsBehind === null
        ? "Workspace behind (count unavailable)"
        : `Workspace behind by ${ws.commitsBehind} commit${ws.commitsBehind === 1 ? "" : "s"}`;
    case "ahead":
      return ws.commitsAhead === null
        ? "Workspace ahead (count unavailable)"
        : `Workspace ahead by ${ws.commitsAhead} commit${ws.commitsAhead === 1 ? "" : "s"}`;
    case "diverged":
      return `Workspace diverged: ${ws.commitsBehind} behind, ${ws.commitsAhead} ahead`;
    case "unknown":
      switch (ws.reason) {
        case "offline-skipped":
          return "Workspace check skipped (offline)";
        case "network-error":
          return "Workspace check failed (network error)";
        case "empty-remote":
          return "Workspace check failed (remote returned no HEAD)";
        case "no-local-head":
          return "Workspace check inconclusive (no HEAD)";
        case "empty-local-head":
          return "Workspace check inconclusive (HEAD resolved to empty output)";
        case "non-git":
        case "no-workspace":
          return "Workspace check skipped (not a git checkout)";
      }
  }
}

async function checkAtlassianAuth(input: RunDoctorInput): Promise<AtlassianAuthReport> {
  const resolver = input.resolveAtlassianAuth ?? defaultResolveAtlassianAuth;
  const baseUrlResolver = input.resolveAtlassianBaseUrl ?? defaultResolveAtlassianBaseUrl;

  const installedFile = input.loadInstalledSkillsForAuth
    ? await input.loadInstalledSkillsForAuth()
    : await defaultLoadInstalledSkills();
  const atlassianSkillsInstalled = installedFile.installed.some(
    (s) => s.sourceCatalogLabel === "atlassian-skills",
  );
  const relevant = atlassianSkillsInstalled || input.hasAtlassianKnowledgeSources === true;

  const auth = resolver();
  if (!auth) {
    return relevant ? { status: "missing" } : { status: "not-applicable" };
  }
  const baseUrl = baseUrlResolver();

  let atlassianSkills: AtlassianSkillsRuntimeStatus | undefined;
  if (atlassianSkillsInstalled) {
    const envVars = input.readEnvForBridge
      ? await input.readEnvForBridge()
      : defaultReadEnvForBridge();
    const bridge = detectBridgeDrift(envVars);
    const python = await (input.detectPython ?? defaultDetectPython)();
    atlassianSkills = {
      installed: true,
      bridgeStatus: bridge.status,
      ...(bridge.status !== "in-sync" ? { bridgeReasons: bridge.reasons } : {}),
      python: {
        binary: python.binary,
        version: python.version,
        versionOk: python.versionOk,
        packagesAvailable: python.packagesAvailable,
      },
    };
  }

  if (!baseUrl) {
    if (!relevant) return { status: "not-applicable" };
    return atlassianSkills
      ? { status: "incomplete", source: auth.source, reason: "missing-base-url", atlassianSkills }
      : { status: "incomplete", source: auth.source, reason: "missing-base-url" };
  }
  return atlassianSkills
    ? { status: "configured", source: auth.source, baseUrl, atlassianSkills }
    : { status: "configured", source: auth.source, baseUrl };
}

function defaultReadEnvForBridge(): Record<string, string> {
  try {
    const raw = readFileSync(join(stateHome(), ".env"));
    return parseDotenv(raw);
  } catch {
    return {};
  }
}

function atlassianAuthEventStatus(auth: AtlassianAuthReport): DoctorSectionDoneEvent["status"] {
  if (auth.status === "configured") return "ok";
  if (auth.status === "not-applicable") return "skipped";
  return "warn";
}

function atlassianAuthSummary(auth: AtlassianAuthReport): string {
  if (auth.status === "configured") {
    return `Atlassian auth configured (source: ${auth.source}, baseUrl: ${auth.baseUrl})`;
  }
  if (auth.status === "incomplete") {
    return `Atlassian auth incomplete: workspace URL missing (Confluence/Jira sources will fail)`;
  }
  if (auth.status === "not-applicable") {
    return "Atlassian auth: not used (no Confluence/Jira sources)";
  }
  return "Atlassian auth not configured (Confluence/Jira sources will fail)";
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function checkSkillDrift(
  cfg: NonNullable<RunDoctorInput["skillDrift"]>,
): Promise<SkillDriftReport> {
  const load = cfg.loadInstalled ?? defaultLoadInstalledSkills;
  const hash = cfg.hashDir ?? defaultHashSkillDir;
  const exists = cfg.pathExists ?? defaultPathExists;
  const file = await load(cfg.homeDir ? { homeDir: cfg.homeDir } : undefined);

  const entries: SkillDriftEntry[] = [];
  for (const e of file.installed) {
    entries.push(await classifySkill(e, hash, exists));
  }
  return { entries };
}

async function classifySkill(
  e: InstalledSkill,
  hash: (path: string) => Promise<string>,
  exists: (path: string) => Promise<boolean>,
): Promise<SkillDriftEntry> {
  // Source-side check first — if the catalog is gone, drift status is moot
  // because the user cannot run `smith skill update` to repair the install.
  if (!(await exists(e.sourcePath))) {
    return { name: e.name, status: "source-missing", sourceDir: e.sourcePath };
  }
  // Use the first present dest path as the canonical sample. The installer
  // copies identical contents to all platforms, so any one of them is
  // sufficient to detect user-edits. Order: opencode, claude-code, codex.
  const dests = [
    e.installedPaths.opencode,
    e.installedPaths.claudeCode,
    e.installedPaths.codex,
  ].filter((p): p is string => typeof p === "string");
  const checkedDest = dests[0];
  if (!checkedDest || !(await exists(checkedDest))) {
    return {
      name: e.name,
      status: "missing",
      checkedDest: checkedDest ?? "(no dest recorded)",
    };
  }
  const currentHash = await hash(checkedDest);
  if (currentHash === e.contentHash) {
    return { name: e.name, status: "ok", checkedDest };
  }
  return {
    name: e.name,
    status: "drift",
    checkedDest,
    recordedHash: e.contentHash,
    currentHash,
  };
}

function skillDriftEventStatus(r: SkillDriftReport): DoctorSectionDoneEvent["status"] {
  if (r.entries.length === 0) return "ok";
  const anyBad = r.entries.some((e) => e.status !== "ok");
  return anyBad ? "warn" : "ok";
}

function skillDriftSummary(r: SkillDriftReport): string {
  if (r.entries.length === 0) return "No installed skills tracked";
  const drifted = r.entries.filter((e) => e.status === "drift").length;
  const missing = r.entries.filter((e) => e.status === "missing").length;
  const sourceMissing = r.entries.filter((e) => e.status === "source-missing").length;
  if (drifted + missing + sourceMissing === 0) {
    return `Installed skills: ${r.entries.length} verified`;
  }
  const parts: string[] = [];
  if (drifted > 0) parts.push(`${drifted} drifted`);
  if (missing > 0) parts.push(`${missing} missing on disk`);
  if (sourceMissing > 0) parts.push(`${sourceMissing} source missing`);
  return `Installed skills: ${parts.join(", ")}`;
}

async function defaultAgentFileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function defaultHashAgentFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return defaultHashContent(await readFile(path, "utf8"));
}

async function checkAgentDrift(
  cfg: NonNullable<RunDoctorInput["agentDrift"]>,
): Promise<AgentDriftReport> {
  const load = cfg.loadInstalled ?? defaultLoadInstalledAgents;
  const hashFile = cfg.hashFile ?? defaultHashAgentFile;
  const exists = cfg.pathExists ?? defaultAgentFileExists;
  const file = await load(cfg.homeDir ? { homeDir: cfg.homeDir } : undefined);
  const entries: AgentDriftEntry[] = [];
  for (const e of file.installed) {
    if (!(await exists(e.path))) {
      entries.push({ name: e.name, platform: e.platform, status: "missing", path: e.path });
      continue;
    }
    const currentHash = await hashFile(e.path);
    if (currentHash === e.contentHash) {
      entries.push({ name: e.name, platform: e.platform, status: "ok", path: e.path });
    } else {
      entries.push({
        name: e.name,
        platform: e.platform,
        status: "drift",
        path: e.path,
        recordedHash: e.contentHash,
        currentHash,
      });
    }
  }
  return { entries };
}

/** @internal Exported for unit testing; not part of the public API. */
export function agentDriftEventStatus(r: AgentDriftReport): DoctorSectionDoneEvent["status"] {
  if (r.entries.length === 0) return "ok";
  return r.entries.some((e) => e.status !== "ok") ? "warn" : "ok";
}

function agentDriftSummary(r: AgentDriftReport): string {
  if (r.entries.length === 0) return "No installed agents tracked";
  const drifted = r.entries.filter((e) => e.status === "drift").length;
  const missing = r.entries.filter((e) => e.status === "missing").length;
  if (drifted + missing === 0) return `Installed agents: ${r.entries.length} verified`;
  const parts: string[] = [];
  if (drifted > 0) parts.push(`${drifted} drifted`);
  if (missing > 0) parts.push(`${missing} missing`);
  return `Installed agents: ${parts.join(", ")}`;
}

async function buildModelResolutionReport(
  cfg: NonNullable<RunDoctorInput["modelResolution"]>,
): Promise<ModelResolutionReport> {
  const opencodeCliPath = await cfg.findOpencodeOnPath();
  const live = await cfg.getOpenCodeModels();
  const installed = await scanInstalledModels(cfg.installedPaths);

  const curatedFallbacks = (["high", "balanced", "fast"] as const).map((tier) => ({
    tier,
    value: cfg.curatedFallback[tier],
    inLiveList: live ? live.includes(cfg.curatedFallback[tier]) : false,
  }));

  const installedAgents = installed
    .filter((e) => e.model !== null)
    .map((e) => ({
      platform: e.platform,
      agent: e.agent,
      model: e.model as string,
      inLiveList:
        e.platform !== "opencode"
          ? null
          : live === undefined
            ? null
            : live.includes(e.model as string),
    }));

  const hasStale = installedAgents.some((a) => a.platform === "opencode" && a.inLiveList === false);

  // --- Per-platform auth matrix ---
  const platformAuthMatrix: PlatformAuthMatrix =
    cfg.platformAuth ?? (await detectAllPlatforms());
  const platforms: ModelResolutionReport["platforms"] = {
    opencode: summarize(platformAuthMatrix.opencode),
    "claude-code": summarize(platformAuthMatrix["claude-code"]),
    codex: summarize(platformAuthMatrix.codex),
    kiro: summarize(platformAuthMatrix.kiro),
  };

  // --- New fields: detectedProviders, preferenceOrder, tierPreview ---
  const detectAuth = cfg.detectAuthenticatedProviders ?? defaultDetectAuthProviders;
  const detectedProviders = await detectAuth();

  // Build preference order with source tagging
  const processEnv = process.env;
  const envProviders = processEnv.SMITH_MODEL_PROVIDERS;
  let preferenceOrder: ModelResolutionReport["preferenceOrder"];

  if (envProviders) {
    preferenceOrder = envProviders
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => ({ provider: p, source: "env" as const }));
  } else {
    const envFile = cfg.readEnvFile?.() ?? {};
    const fileProviders = envFile.SMITH_MODEL_PROVIDERS;
    if (fileProviders) {
      preferenceOrder = fileProviders
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => ({ provider: p, source: "file" as const }));
    } else {
      preferenceOrder = sortByOpenCodePrecedence(detectedProviders).map((p) => ({
        provider: p,
        source: "default" as const,
      }));
    }
  }

  // Tier resolution preview — resolves once via OpenCode for the legacy
  // top-line `resolved` field, then once per platform for the new
  // perPlatform map.
  const tiers = ["high", "balanced", "fast"] as const;
  const tierPreview: ModelResolutionReport["tierPreview"] = [];
  const noopWarnings = { push() {} };
  for (const tier of tiers) {
    let resolved: string | null = null;
    let source: "override" | "live" | "curated" | "failed" = "failed";
    let message: string | undefined;
    try {
      const r = await resolveOpenCodeModel(
        { name: "__doctor__", modelTier: tier, targets: ["opencode"] } as any,
        {
          getOpenCodeModels: cfg.getOpenCodeModels,
          warnings: noopWarnings,
          detectAuthenticatedProviders: detectAuth,
          // Pass through the platform auth matrix so the resolver's
          // lazy fail-loud-with-cli-detection path uses the same
          // verdict as the rest of the doctor preview.
          detectOpenCodeAuth: async () => platformAuthMatrix.opencode,
        },
      );
      if (r) {
        resolved = r;
        const envKey = `SMITH_TIER_${tier.toUpperCase()}`;
        if (processEnv[envKey]) source = "override";
        else if (live && live.includes(r)) source = "live";
        else source = "curated";
      } else {
        message = "tier returned undefined (inherit)";
      }
    } catch (err) {
      message =
        err instanceof SmithError && err.code === "model-resolution-failed"
          ? `set SMITH_TIER_${tier.toUpperCase()} or run \`opencode auth login\``
          : toMessage(err);
    }

    // Per-platform resolution. Each resolver consults its own auth state
    // (overridden by the test fixture matrix when present). A resolver
    // that returns undefined means "this platform can't resolve this tier"
    // — we report null in the matrix.
    const perPlatform = await resolvePerPlatformTier(tier, cfg, platformAuthMatrix);

    tierPreview.push({ tier, resolved, perPlatform, source, ...(message ? { message } : {}) });
  }

  return {
    opencodeCliPath,
    liveModelCount: live === undefined ? null : live.length,
    curatedFallbacks,
    installedAgents,
    hasStale,
    detectedProviders,
    preferenceOrder,
    platforms,
    tierPreview,
  };
}

/**
 * Project a {@link PlatformAuth} into the doctor-facing summary slice.
 * Drops the platform field (already keyed in the parent record) and any
 * internal scaffolding that doesn't belong in the doctor JSON output.
 */
function summarize(p: PlatformAuth): ModelResolutionReport["platforms"][PlatformId] {
  return {
    cliInstalled: p.cliInstalled,
    status: p.status,
    ...(p.detail !== undefined ? { detail: p.detail } : {}),
    ...(p.availableModels !== undefined ? { availableModels: p.availableModels } : {}),
  };
}

/**
 * For a given tier, resolve a model literal on every platform and return
 * the matrix. `null` for any platform that can't resolve (CLI absent,
 * unauthenticated, or resolver returns undefined for any reason).
 */
async function resolvePerPlatformTier(
  tier: "high" | "balanced" | "fast",
  cfg: NonNullable<RunDoctorInput["modelResolution"]>,
  matrix: PlatformAuthMatrix,
): Promise<Record<PlatformId, string | null>> {
  const noop = { push() {} };
  const env = (platformDetect: () => Promise<PlatformAuth>) => ({
    getOpenCodeModels: cfg.getOpenCodeModels,
    warnings: noop,
    detectAuthenticatedProviders: cfg.detectAuthenticatedProviders ?? defaultDetectAuthProviders,
    detectClaudeCodeAuth: platformDetect,
    detectCodexAuth: platformDetect,
    detectKiroAuth: platformDetect,
  });
  // Each call asks one resolver about a fake bundle that targets only
  // that platform. Returning `undefined` is the resolver's signal to the
  // installer that resolution failed; we surface it as null in the matrix.
  const fakeBundle = (target: PlatformId) =>
    ({ name: "__doctor__", modelTier: tier, targets: [target] }) as any;

  const [opencode, claudeCode, codex, kiro] = await Promise.all([
    safeResolve(() =>
      resolveOpenCodeModel(fakeBundle("opencode"), {
        getOpenCodeModels: cfg.getOpenCodeModels,
        warnings: noop,
        detectAuthenticatedProviders: cfg.detectAuthenticatedProviders ?? defaultDetectAuthProviders,
        // Preview is a doctor-side surface; we already know the
        // matrix's opencode auth verdict. Pass it through so the
        // resolver's lazy fail-loud-with-cli-detection path
        // (added 2026-06) gets the same answer as a live resolution.
        detectOpenCodeAuth: async () => matrix.opencode,
      }),
    ),
    safeResolve(() =>
      resolveClaudeCodeModel(fakeBundle("claude-code"), env(async () => matrix["claude-code"])),
    ),
    safeResolve(() => resolveCodexModel(fakeBundle("codex"), env(async () => matrix.codex))),
    safeResolve(() => resolveKiroModel(fakeBundle("kiro"), env(async () => matrix.kiro))),
  ]);

  return {
    opencode,
    "claude-code": claudeCode,
    codex,
    kiro,
  };
}

async function safeResolve(fn: () => Promise<string | undefined>): Promise<string | null> {
  try {
    const r = await fn();
    return r ?? null;
  } catch {
    return null;
  }
}

function manualPlatform(
  platform: "claude-code" | "codex" | "kiro",
  meta: ToolMapMeta,
): DoctorPlatformReport {
  return {
    platform,
    lastVerifiedDate: meta.lastVerifiedDate,
    verifiedAgainstVersion: meta.verifiedAgainstVersion,
    sourceUrl: meta.sourceUrl,
    notes: meta.notes,
    status: "manual",
  };
}

async function checkOpencode(
  vendored: Record<string, unknown>,
  meta: SchemaMeta,
  deps: DoctorDeps,
): Promise<Extract<DoctorPlatformReport, { platform: "opencode" }>> {
  const base = {
    platform: "opencode" as const,
    vendoredDate: meta.lastVerifiedDate,
    sourceUrl: meta.sourceUrl,
    liveSchemaId: null as string | null,
    liveVersion: null as string | null,
  };
  const now = deps.now();

  if (deps.offline) {
    return { ...base, status: "offline-skipped" };
  }

  let live: Record<string, unknown> | null = null;

  if (!deps.noCache) {
    const cache = await deps.readCache(deps.cachePath);
    if (isCacheFresh(cache, now, deps.ttlMs) && cache !== null) {
      live = cache.schema;
    }
  }

  if (live === null) {
    try {
      const resp = await deps.fetch(meta.sourceUrl);
      if (!resp.ok) {
        return { ...base, status: "network-error", networkError: `HTTP ${resp.status}` };
      }
      live = (await resp.json()) as Record<string, unknown>;
      await deps.writeCache(deps.cachePath, {
        fetchedAt: now.toISOString(),
        schema: live,
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        status: "network-error",
        networkError: `fetch failed for ${redactSecrets(meta.sourceUrl)}: ${redactSecrets(cause)}`,
      };
    }
  }

  const liveSchemaId = typeof live.$id === "string" ? live.$id : null;
  const liveVersion = typeof live.version === "string" ? live.version : null;

  const drift = diffSchemas(vendored, live);
  const totalChanges = drift.added.length + drift.removed.length + drift.changed.length;

  if (totalChanges === 0) {
    return { ...base, liveSchemaId, liveVersion, status: "fresh" };
  }
  return { ...base, liveSchemaId, liveVersion, status: "drift", drift };
}

async function defaultLoadInstalledSkillNames(): Promise<string[]> {
  const file = await defaultLoadInstalledSkills();
  return file.installed.map((e) => e.name);
}

async function checkAgentRequiredSkills(
  loadAgents: () => Promise<Array<{ name: string; requires?: { skills?: RequiredSkillEntry[] } }>>,
  loadInstalledNames: () => Promise<string[]>,
): Promise<AgentRequiredSkillsReport> {
  const agents = await loadAgents();
  const installedNames = await loadInstalledNames();
  const agentReports: AgentRequiredSkillsReport["agents"] = [];
  for (const a of agents) {
    const required = a.requires?.skills ?? [];
    if (required.length === 0) continue;
    const missing = diffRequiredSkills(required, installedNames);
    if (missing.length > 0) {
      agentReports.push({ name: a.name, missing });
    }
  }
  const status = agentReports.length === 0 ? "ok" : "warn";
  return { status, agents: agentReports };
}

function agentRequiredSkillsSummary(r: AgentRequiredSkillsReport): string {
  if (r.status === "ok") return "All agents' required skills are installed";
  return `${r.agents.length} agent${r.agents.length === 1 ? "" : "s"} have missing required skills`;
}

async function checkRegistryHygiene(
  cfg: NonNullable<RunDoctorInput["registryHygiene"]>,
): Promise<RegistryHygieneReport> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const reg = await loadRegistry(cfg.registryPath);
  for (const s of reg.sources) {
    let sniff: Awaited<ReturnType<typeof sniffPath>>;
    try {
      sniff = await sniffPath(s.rootPath);
    } catch (err) {
      errors.push(`agent catalog '${s.label}': ${toMessage(err)}`);
      continue;
    }
    if (!sniff.exists) {
      warnings.push(
        `agent catalog '${s.label}': rootPath ${s.rootPath} does not exist — run \`smith agent unregister ${s.label}\` to remove it`,
      );
      continue;
    }
    if (sniff.agentBundles === 0 && !sniff.isSingleAgentBundle) {
      warnings.push(`agent catalog '${s.label}': contains no agent bundles (${s.rootPath})`);
    }
    if (sniff.emptyBundleDirs.length > 0) {
      const list = sniff.emptyBundleDirs.slice(0, 5).join(", ");
      const more =
        sniff.emptyBundleDirs.length > 5 ? ` (+${sniff.emptyBundleDirs.length - 5} more)` : "";
      warnings.push(
        `agent catalog '${s.label}': ${sniff.emptyBundleDirs.length} empty bundle directories — likely leftover from aborted \`smith agent init\` runs (${list}${more}). Remove with \`rmdir ${s.rootPath}/<name>\`.`,
      );
    }
    if (s.gitRemote) {
      const verify = await verifyGitRemote(s.rootPath, s.gitRemote, cfg.runGit);
      if (!verify.ok) {
        if (verify.reason === "not-a-git-repo") {
          warnings.push(
            `agent catalog '${s.label}': rootPath is not a git repo (gitRemote=${s.gitRemote})`,
          );
        } else {
          warnings.push(
            `agent catalog '${s.label}': gitRemote ${s.gitRemote} does not match any configured remote`,
          );
        }
      }
    }
  }

  const skillReg = await loadSkillRegistry(cfg.skillRegistryPath);
  for (const c of skillReg.catalogs) {
    if (c.protected) continue;
    let sniff: Awaited<ReturnType<typeof sniffPath>>;
    try {
      sniff = await sniffPath(c.rootPath);
    } catch (err) {
      errors.push(`skill catalog '${c.label}': ${toMessage(err)}`);
      continue;
    }
    if (!sniff.exists) {
      warnings.push(
        `skill catalog '${c.label}': rootPath ${c.rootPath} does not exist — run \`smith skill unregister ${c.label}\` to remove it`,
      );
      continue;
    }
    if (sniff.skillBundles === 0 && !sniff.isSingleSkillBundle) {
      warnings.push(`skill catalog '${c.label}': contains no skills (${c.rootPath})`);
    }
    if (c.gitRemote) {
      const verify = await verifyGitRemote(c.rootPath, c.gitRemote, cfg.runGit);
      if (!verify.ok) {
        if (verify.reason === "not-a-git-repo") {
          warnings.push(
            `skill catalog '${c.label}': rootPath is not a git repo (gitRemote=${c.gitRemote})`,
          );
        } else {
          warnings.push(
            `skill catalog '${c.label}': gitRemote ${c.gitRemote} does not match any configured remote`,
          );
        }
      }
    }
  }

  return { warnings, errors };
}

function registryHygieneEventStatus(r: RegistryHygieneReport): DoctorSectionDoneEvent["status"] {
  if (r.errors.length > 0) return "error";
  if (r.warnings.length > 0) return "warn";
  return "ok";
}

function registryHygieneSummary(r: RegistryHygieneReport): string {
  if (r.errors.length > 0)
    return `Registry hygiene: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`;
  if (r.warnings.length > 0) return `Registry hygiene: ${r.warnings.length} warning(s)`;
  return "Registry hygiene: ok";
}

function remoteCatalogsEventStatus(r: RemoteCatalogsReport): DoctorSectionDoneEvent["status"] {
  // All findings are informational (warn). No error path today — IO
  // failures during loadRegistry propagate as exceptions, which the
  // doctor orchestrator already handles via the outer try in the CLI
  // layer.
  if (r.findings.length > 0) return "warn";
  return "ok";
}

function remoteCatalogsSummary(r: RemoteCatalogsReport): string {
  if (r.findings.length === 0) return "Remote catalogs: ok";
  const behind = r.findings.filter((f) => f.finding === "catalog-behind-remote").length;
  const stale = r.findings.filter((f) => f.finding === "catalog-stale-check").length;
  const parts: string[] = [];
  if (behind > 0) parts.push(`${behind} behind`);
  if (stale > 0) parts.push(`${stale} stale check-in`);
  return `Remote catalogs: ${parts.join(", ")}`;
}

function knowledgeRefreshEventStatus(r: RefreshHooksReport): DoctorSectionDoneEvent["status"] {
  // Detection layer never returns "error" today, but keep the mapping
  // exhaustive so future hard-failure findings propagate correctly.
  if (r.status === "error") return "error";
  if (r.status === "warn") return "warn";
  return "ok";
}

function knowledgeRefreshSummary(r: RefreshHooksReport): string {
  if (r.findings.length === 0) return "Knowledge refresh: ok";
  return `Knowledge refresh: ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`;
}

function knowledgeCompileEventStatus(
  r: KnowledgeCompileReport,
): DoctorSectionDoneEvent["status"] {
  // The detector never returns "error" today — every finding is a
  // user-fixable drift signal. Map status verbatim and keep the switch
  // open for a future hard-failure kind (e.g. unreadable knowledge dir).
  return r.status === "warn" ? "warn" : "ok";
}

function knowledgeCompileSummary(r: KnowledgeCompileReport): string {
  if (r.findings.length === 0) return "Knowledge compile: ok";
  const missing = r.findings.filter((f) => f.kind === "missing-manifest").length;
  const drift = r.findings.filter((f) => f.kind === "drift").length;
  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} missing-manifest`);
  if (drift > 0) parts.push(`${drift} drift`);
  return `Knowledge compile: ${parts.join(", ")}`;
}

function duplicateCatalogsEventStatus(
  r: DuplicateCatalogsReport,
): DoctorSectionDoneEvent["status"] {
  // [v1-task RC2-10] Clusters are informational only — duplicates may
  // be intentional (e.g. two labels for the same upstream). No error
  // path: malformed URLs are silently excluded in the pure check.
  if (r.clusters.length > 0) return "warn";
  return "ok";
}

function duplicateCatalogsSummary(r: DuplicateCatalogsReport): string {
  if (r.clusters.length === 0) return "Duplicate catalogs: ok";
  const totalDupes = r.clusters.reduce((sum, c) => sum + c.members.length, 0);
  return `Duplicate catalogs: ${r.clusters.length} cluster${r.clusters.length === 1 ? "" : "s"} (${totalDupes} entries)`;
}

function mcpSpawnEventStatus(r: McpSpawnSection): DoctorSectionDoneEvent["status"] {
  return r.status === "fragile-spawn" ? "warn" : "ok";
}

function mcpSpawnSummary(r: McpSpawnSection): string {
  if (r.findings.length === 0) return "MCP spawn commands: ok";
  const n = r.findings.length;
  return `MCP spawn commands: ${n} fragile entr${n === 1 ? "y" : "ies"}`;
}

function mcpDepsEventStatus(r: { findings: McpDepFinding[] }): DoctorSectionDoneEvent["status"] {
  if (r.findings.length === 0) return "ok";
  return r.findings.some((f) => f.severity === "error") ? "error" : "warn";
}

function mcpDepsSummary(r: { findings: McpDepFinding[] }): string {
  if (r.findings.length === 0) return "MCP dependencies: ok";
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const warnings = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} required missing`);
  if (warnings > 0) parts.push(`${warnings} peer missing`);
  return `MCP dependencies: ${parts.join(", ")}`;
}

function lazyFetchEventStatus(r: { findings: LazyFetchFinding[] }): DoctorSectionDoneEvent["status"] {
  if (r.findings.some((f) => f.severity === "error")) return "error";
  if (r.findings.length > 0) return "warn";
  return "ok";
}

function lazyFetchSummary(r: { findings: LazyFetchFinding[] }): string {
  if (r.findings.length === 0) return "Lazy URL fetch: ok";
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const warnings = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} unreachable`);
  if (warnings > 0) parts.push(`${warnings} via missing`);
  return `Lazy URL fetch: ${parts.join(", ")}`;
}

function urlRoutingEventStatus(r: CheckUrlRoutingResult): DoctorSectionDoneEvent["status"] {
  // Ambiguities are informational warnings — multiple sources claiming the
  // same pattern is unusual but not a hard failure (the resolver picks
  // the most-authoritative layer at fetch time). The detector never
  // returns "error" today.
  if (r.ambiguities.length > 0) return "warn";
  return "ok";
}

function urlRoutingSummary(r: CheckUrlRoutingResult): string {
  if (r.entries.length === 0) return "URL routing: no routes registered";
  const total = r.entries.length;
  const routesWord = `${total} route${total === 1 ? "" : "s"}`;
  if (r.ambiguities.length === 0) return `URL routing: ${routesWord}`;
  const n = r.ambiguities.length;
  return `URL routing: ${routesWord}, ${n} ambiguous pattern${n === 1 ? "" : "s"}`;
}

function knowledgeConsistencyEventStatus(
  r: KnowledgeConsistencyReport,
): DoctorSectionDoneEvent["status"] {
  if (r.status === "skipped" && r.orphanTrees.length === 0) return "skipped";
  if (r.status === "skipped" && r.orphanTrees.length > 0) return "warn";
  if (r.status === "drift") return "warn";
  if (r.orphanTrees.length > 0) return "warn";
  return "ok";
}

function knowledgeConsistencySummary(r: KnowledgeConsistencyReport): string {
  if (r.status === "skipped" && r.orphanTrees.length === 0)
    return "Knowledge consistency: no agents with knowledge index";
  if (r.status === "skipped" && r.orphanTrees.length > 0)
    return `Knowledge consistency: ${r.orphanTrees.length} orphan tree${r.orphanTrees.length === 1 ? "" : "s"}`;
  if (r.status === "ok" && r.orphanTrees.length === 0)
    return "Knowledge consistency: all files present";
  if (r.status === "ok" && r.orphanTrees.length > 0)
    return `Knowledge consistency: all files present, ${r.orphanTrees.length} orphan tree${r.orphanTrees.length === 1 ? "" : "s"}`;
  const drifted = r.agents.filter(
    (a) =>
      a.missingFiles.length > 0 ||
      a.brokenSymlinks.length > 0 ||
      a.manifestMismatchFiles.length > 0,
  ).length;
  return `Knowledge consistency: ${drifted} agent${drifted === 1 ? "" : "s"} with drift`;
}
