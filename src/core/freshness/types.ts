/**
 * Public types for the freshness ("smith doctor") subsystem.
 * Pure data — no behavior. All side-effects (fetch, fs, clock) live in
 * src/cli/commands/doctor.ts; src/core/freshness/* is dependency-injected.
 */

import type { PlatformId } from "../../io/platform-detect";
import type { WorkspaceVersionStatus } from "../../io/workspace-version";

// Re-export so downstream consumers can import platform identifiers from
// the freshness public surface without reaching into io/.
export type { PlatformId };

/** Provenance block carried by every tool-map JSON file. */
export interface ToolMapMeta {
  lastVerifiedDate: string; // YYYY-MM-DD
  verifiedAgainstVersion: string;
  sourceUrl: string;
  notes: string;
}

/** Provenance block for the OpenCode schema sidecar (different fields). */
export interface SchemaMeta {
  lastVerifiedDate: string; // YYYY-MM-DD
  sourceUrl: string;
  schemaId: string | null;
  version: string | null;
  notes: string;
}

/** Per-platform freshness report row. */
export type DoctorPlatformReport =
  | ({
      platform: "opencode";
      vendoredDate: string;
      sourceUrl: string;
      liveSchemaId: string | null;
      liveVersion: string | null;
    } & (
      | { status: "fresh" }
      | { status: "drift"; drift: DriftSummary }
      | { status: "network-error"; networkError: string }
      | { status: "offline-skipped" }
    ))
  | {
      platform: "claude-code";
      lastVerifiedDate: string;
      verifiedAgainstVersion: string;
      sourceUrl: string;
      notes: string;
      status: "manual";
    }
  | {
      platform: "codex";
      lastVerifiedDate: string;
      verifiedAgainstVersion: string;
      sourceUrl: string;
      notes: string;
      status: "manual";
    }
  | {
      platform: "kiro";
      lastVerifiedDate: string;
      verifiedAgainstVersion: string;
      sourceUrl: string;
      notes: string;
      status: "manual";
    };

/** Atlassian auth resolution status. Reflects the presence of credentials. */
export type AtlassianAuthReport =
  | {
      status: "configured";
      source: "env-smith" | "file-smith";
      /** Resolved workspace base URL (e.g. `https://acme.atlassian.net`). */
      baseUrl: string;
      atlassianSkills?: AtlassianSkillsRuntimeStatus;
    }
  | {
      /**
       * Email + token resolved, but no workspace base URL is set in any
       * tier. Confluence/Jira sources will fail at fetch time with a
       * `usage-error` until the user sets `SMITH_ATLASSIAN_BASE_URL`.
       */
      status: "incomplete";
      source: "env-smith" | "file-smith";
      reason: "missing-base-url";
      atlassianSkills?: AtlassianSkillsRuntimeStatus;
    }
  | { status: "missing" }
  | {
      /**
       * Nothing depends on Atlassian — no `confluence`/`jira` knowledge
       * source and `atlassian-skills` not installed. Surfaced as a one-line
       * `ℹ` in the default view; full setup hint under `--verbose`.
       */
      status: "not-applicable";
    };

/**
 * Reported when atlassian-skills is detected as installed in any
 * platform skill dir. Sub-checks: bridge sync, Python availability,
 * required packages.
 */
export interface AtlassianSkillsRuntimeStatus {
  installed: true;
  bridgeStatus: "in-sync" | "not-bridged" | "drift";
  bridgeReasons?: string[];
  python: {
    binary: "python3" | "python" | null;
    version: string | null;
    versionOk: boolean;
    packagesAvailable: { requests: boolean; dotenv: boolean };
  };
}

/**
 * Installed-skill drift report. One entry per skill recorded in
 * the installer state file (`installed-skills.json`).
 *
 * - `ok`: the dest dir's recursive content hash matches the recorded hash.
 * - `drift`: hashes differ — user (or another tool) edited the installed
 *   copy. `smith skill update` will overwrite local edits.
 * - `missing`: the recorded dest dir no longer exists (manual delete).
 * - `source-missing`: the source dir referenced by the install record is
 *   gone. Update will fail until the source catalog is restored.
 */
export type SkillDriftEntry =
  | { name: string; status: "ok"; checkedDest: string }
  | {
      name: string;
      status: "drift";
      checkedDest: string;
      recordedHash: string;
      currentHash: string;
    }
  | { name: string; status: "missing"; checkedDest: string }
  | { name: string; status: "source-missing"; sourceDir: string };

export interface SkillDriftReport {
  entries: SkillDriftEntry[];
}

// Mirrors SkillDriftEntry but for single rendered agent files — no `source-missing`
// variant: agents render from the registered bundle, not a copied source dir.
export type AgentDriftEntry =
  | { name: string; platform: string; status: "ok"; path: string }
  | {
      name: string;
      platform: string;
      status: "drift";
      path: string;
      recordedHash: string;
      currentHash: string;
    }
  | { name: string; platform: string; status: "missing"; path: string };

export interface AgentDriftReport {
  entries: AgentDriftEntry[];
}

/**
 * Agent ↔ skill binding report. One entry per agent that declares
 * `requires.skills` AND has at least one not currently installed. Agents
 * with no requires.skills, or whose requirements are fully satisfied, are
 * NOT included in the report list (status reflects the aggregate).
 */
export interface AgentRequiredSkillsReport {
  status: "ok" | "warn";
  agents: Array<{
    name: string;
    /** Required skills not currently installed. */
    missing: Array<{ catalog?: string; name: string }>;
  }>;
}

/**
 * Registry hygiene report — surfaces stale entries in the agent
 * and skill registries (paths gone, empty catalogs, git remote
 * mismatches). Informational only; never affects exit code.
 *
 * - `warnings`: soft problems users can ignore or unregister.
 * - `errors`: I/O or permission failures encountered while
 *   inspecting an entry. Rare; hides nothing from the user.
 *
 * Each string is a complete human-readable line. The renderer
 * prefixes each with a status marker; producers should not
 * include "warn"/"error" prefixes themselves.
 */
export interface RegistryHygieneReport {
  warnings: string[];
  errors: string[];
}

/** Top-level report returned by run-doctor. */
export interface DoctorReport {
  generatedAt: string; // ISO 8601
  platforms: DoctorPlatformReport[];
  /**
   * Platform IDs that were skipped because their CLI binary was not
   * detected on PATH. Always present (empty array when all three platforms
   * were probed and found) so downstream consumers can rely on a stable
   * shape. Order is not guaranteed.
   */
  skippedPlatforms: PlatformId[];
  /** Optional model-resolution health check. Omitted when CLI runs with --skip-model-resolution. */
  modelResolution?: ModelResolutionReport;
  /**
   * Optional workspace freshness check. Undefined when path resolution
   * returns null (e.g. the CLI is invoked from a directory outside the
   * agent-smith workspace tree) or when the caller didn't request it.
   * Informational only — never affects {@link DoctorReport.exitCode}.
   */
  workspace?: WorkspaceVersionStatus;
  /**
   * Optional Atlassian auth status. Undefined when the caller doesn't request
   * the check. Informational only — never affects {@link DoctorReport.exitCode}.
   */
  atlassianAuth?: AtlassianAuthReport;
  /**
   * Optional installed-skill drift report. Undefined when the
   * caller doesn't request the check. Drift is informational only — never
   * affects {@link DoctorReport.exitCode}, since users may legitimately
   * tweak installed skills before the next `smith skill update`.
   */
  skillDrift?: SkillDriftReport;
  /** Optional installed-agent drift report. Informational; never affects exitCode. */
  agentDrift?: AgentDriftReport;
  /**
   * Optional agent ↔ required-skill check. Undefined when the
   * caller doesn't request the check. Informational only — never affects
   * {@link DoctorReport.exitCode}; users may legitimately defer skill
   * installation. The renderer surfaces a `smith skill install <ref>`
   * remediation per missing entry.
   */
  agentRequiredSkills?: AgentRequiredSkillsReport;
  /**
   * Optional registry hygiene report. Undefined when the caller
   * doesn't request the check. Walks both registries and runs
   * sniffPath + verifyGitRemote on each entry. Informational only —
   * never affects {@link DoctorReport.exitCode}.
   */
  registryHygiene?: RegistryHygieneReport;
  /**
   * Optional remote-catalogs freshness report (v1-task C3.14).
   * Undefined when the caller doesn't request it. Walks both
   * registries and reports drift (lastPulledSha vs lastRemoteSha) and
   * stale check-in timestamps. Informational only — never affects
   * {@link DoctorReport.exitCode}.
   */
  remoteCatalogs?: import("./remote-catalogs").RemoteCatalogsReport;
  /**
   * Optional knowledge-refresh detection report. Undefined when the caller
   * doesn't request the check. Informational only — never affects
   * {@link DoctorReport.exitCode}. Repair is handled by a separate flow.
   */
  knowledgeRefresh?: import("./check-refresh-hooks").RefreshHooksReport;
  /**
   * Optional knowledge-compile detection report. Undefined when the caller
   * doesn't request the check. Informational only — never affects
   * {@link DoctorReport.exitCode}. Repair is handled by the CLI's
   * `--fix-knowledge-compile` flag.
   */
  knowledgeCompile?: import("./check-knowledge-compile").KnowledgeCompileReport;
  /**
   * Optional mcp-spawn-commands audit report. Walks each platform's MCP
   * config and flags any `command` field that isn't an absolute path.
   * The legacy v2.1 GUI toggle wrote bare names like "smith" that fail
   * to spawn under Spotlight/dock-launched GUIs (no shell PATH inherit).
   * Repair is wired by the CLI's `--fix-mcp-commands` flag.
   * Informational only — never affects {@link DoctorReport.exitCode}.
   */
  mcpSpawnCommands?: import("./check-mcp-spawn").McpSpawnSection;
  /**
   * Optional duplicate-catalogs check (v1-task RC2-10). Walks both
   * registries and groups entries by normalized git URL; reports
   * clusters of size >= 2 so the user can clean up accidental
   * back-catalog duplicates left over from rc.1. Informational only
   * — never affects {@link DoctorReport.exitCode}.
   */
  duplicateCatalogs?: import("./duplicate-catalogs").DuplicateCatalogsReport;
  /**
   * Optional knowledge-prompt-disk-consistency report. Undefined when the
   * caller doesn't request the check. Informational only — never affects
   * {@link DoctorReport.exitCode}.
   */
  knowledgeConsistency?: import("./check-knowledge-consistency").KnowledgeConsistencyReport;
  /**
   * 0 = no drift; 1 = OpenCode drift OR stale model resolution; 2 = network error (without --offline).
   * Literal so callers can pass directly to `process.exit` without narrowing.
   */
  exitCode: 0 | 1 | 2;
}

export interface ModelResolutionReport {
  /** Path to opencode binary on PATH, or null if not found. */
  opencodeCliPath: string | null;
  /** Live model list count, or null if CLI absent. */
  liveModelCount: number | null;
  /** Curated-fallback verification per tier. */
  curatedFallbacks: Array<{
    tier: "high" | "balanced" | "fast";
    value: string;
    inLiveList: boolean;
  }>;
  /** One entry per installed agent with a `model:` line. */
  installedAgents: Array<{
    platform: PlatformId;
    agent: string;
    model: string;
    /** True if model is in live list, false if not, null if list unavailable or model is a Claude Code tier name. */
    inLiveList: boolean | null;
  }>;
  /** True if any installed-opencode agent's model is not in live list. */
  hasStale: boolean;
  /** Detected authenticated providers (from auth.json or live inference). */
  detectedProviders: string[];
  /** Provider preference order with provenance. */
  preferenceOrder: Array<{ provider: string; source: "env" | "file" | "default" }>;
  /**
   * Per-platform auth matrix. Each entry describes whether that platform's
   * CLI is installed, whether credentials are present, and what models the
   * resolver would emit. The doctor renders a readiness column per
   * platform; the installer consults this to skip targets that aren't
   * authenticated rather than failing the whole install.
   */
  platforms: Record<PlatformId, PlatformAuthSummary>;
  /** Tier resolution preview: one entry per high|balanced|fast. */
  tierPreview: Array<{
    tier: "high" | "balanced" | "fast";
    /**
     * Legacy single-value resolution preserved for backward compat.
     * Reflects the OpenCode resolver's output specifically.
     */
    resolved: string | null;
    /** Per-platform resolution. `null` means the platform can't resolve this tier (unauth or CLI missing). */
    perPlatform: Record<PlatformId, string | null>;
    source: "override" | "live" | "curated" | "failed";
    message?: string;
  }>;
}

/**
 * Public, doctor-facing slice of {@link PlatformAuth}. We deliberately
 * expose only the fields needed for rendering and exit-code logic — the
 * full struct stays internal to `src/io/auth/`.
 */
export interface PlatformAuthSummary {
  cliInstalled: boolean;
  status: "authenticated" | "unauthenticated" | "cli-not-installed" | "unknown";
  detail?: string;
  availableModels?: string[];
}

/** Structural diff result for OpenCode schema. */
export interface DriftSummary {
  added: string[]; // JSON paths added in live
  removed: string[]; // JSON paths removed from live
  changed: string[]; // JSON paths whose value changed
  /** Human-readable one-line headline (e.g. "2 new permission groups, 1 removed"). */
  headline: string;
}

/** Cache file shape on disk. */
export interface SchemaCache {
  fetchedAt: string; // ISO 8601
  schema: Record<string, unknown>;
}

/** Options threaded through run-doctor for testability. */
export interface DoctorDeps {
  fetch: (url: string) => Promise<Response>;
  now: () => Date;
  readCache: (path: string) => Promise<SchemaCache | null>;
  writeCache: (path: string, value: SchemaCache) => Promise<void>;
  cachePath: string;
  ttlMs: number;
  offline: boolean;
  noCache: boolean;
}
