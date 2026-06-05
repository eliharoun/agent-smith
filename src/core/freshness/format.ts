import { join } from "node:path";
import pc from "picocolors";
import { tokenCreationInstructions } from "../../io/atlassian-auth";
import { stateHome } from "../../io/state-home";
import type { WorkspaceVersionStatus } from "../../io/workspace-version";
import type {
  Finding as KnowledgeCompileFinding,
  KnowledgeCompileReport,
} from "./check-knowledge-compile";
import type { McpSpawnFinding, McpSpawnSection } from "./check-mcp-spawn";
import type { Finding as RefreshFinding, RefreshHooksReport } from "./check-refresh-hooks";
import type { DuplicateCatalogsReport } from "./duplicate-catalogs";
import type { RemoteCatalogsReport } from "./remote-catalogs";
import type { CapturedSectionSummary } from "./run-doctor";
import type {
  AgentDriftReport,
  AgentRequiredSkillsReport,
  AtlassianAuthReport,
  DoctorPlatformReport,
  DoctorReport,
  RegistryHygieneReport,
  SkillDriftReport,
} from "./types";

const REPO_URL = "https://github.com/eliharoun/agent-smith";
const MAX_PATHS_SHOWN = 5;

function formatPathList(label: string, paths: string[]): string {
  if (paths.length === 0) return "";
  const shown = paths.slice(0, MAX_PATHS_SHOWN);
  const more = paths.length > MAX_PATHS_SHOWN ? ` (+${paths.length - MAX_PATHS_SHOWN} more)` : "";
  return `    ${label}${more}:\n${shown.map((p) => `      ${p}`).join("\n")}`;
}

export function formatOpencodeSection(
  p: Extract<DoctorPlatformReport, { platform: "opencode" }>,
): string {
  const lines: string[] = [];
  lines.push("OpenCode:");
  lines.push(`  Vendored schema:  ${p.vendoredDate} (from data/opencode.config.schema.json)`);
  switch (p.status) {
    case "fresh":
      lines.push(
        `  Live schema:      ${p.liveSchemaId ?? "(no $id)"} ${p.liveVersion ? `v${p.liveVersion}` : ""}`.trimEnd(),
      );
      lines.push(`  Status:           FRESH (no structural drift)`);
      break;
    case "drift":
      lines.push(`  Status:           DRIFT DETECTED`);
      lines.push(`  Diff summary:     ${p.drift.headline}`);
      {
        const added = formatPathList("Added", p.drift.added);
        const removed = formatPathList("Removed", p.drift.removed);
        const changed = formatPathList("Changed", p.drift.changed);
        for (const block of [added, removed, changed]) if (block) lines.push(block);
      }
      lines.push(`  Action:           smith update`);
      lines.push(`                    if drift persists, file an issue at ${REPO_URL}/issues`);
      break;
    case "network-error":
      lines.push(`  Status:           NETWORK ERROR`);
      lines.push(`  Error:            ${p.networkError}`);
      lines.push(`  Hint:             Re-run with --offline to skip the live fetch.`);
      break;
    case "offline-skipped":
      lines.push(`  Status:           OFFLINE (live fetch skipped)`);
      break;
    default: {
      const _exhaustive: never = p;
      throw new Error(`unhandled opencode status: ${JSON.stringify(p)}`);
    }
  }
  lines.push(`  Source URL:       ${p.sourceUrl}`);
  return lines.join("\n");
}

type ManualPlatformReport = Extract<DoctorPlatformReport, { status: "manual" }>;

function formatManualSection(label: string, p: ManualPlatformReport): string {
  return [
    `${label}:`,
    `  Tool map last verified: ${p.lastVerifiedDate}`,
    `  Verified against:       ${p.verifiedAgainstVersion}`,
    `  Source URL:             ${p.sourceUrl}`,
    `  Status:                 MANUAL (no automated check available)`,
    `  Notes:                  ${p.notes || "(none)"}`,
    `  Suggestion:             If you've noticed missing/renamed tools, file an issue`,
    `                          or PR at ${REPO_URL}`,
  ].join("\n");
}

export function formatClaudeCodeSection(
  p: Extract<DoctorPlatformReport, { platform: "claude-code" }>,
): string {
  return formatManualSection("Claude Code", p);
}

export function formatCodexSection(
  p: Extract<DoctorPlatformReport, { platform: "codex" }>,
): string {
  return formatManualSection("Codex", p);
}

export function formatKiroSection(
  p: Extract<DoctorPlatformReport, { platform: "kiro" }>,
): string {
  return formatManualSection("Kiro", p);
}

/** Render a DoctorReport as a human-readable plain-text block (no trailing newline). */
export function formatReport(report: DoctorReport): string {
  const blocks: string[] = [];
  if (report.skippedPlatforms.length > 0) {
    blocks.push(
      pc.dim(`Skipped platforms (CLI not on PATH): ${report.skippedPlatforms.join(", ")}`),
    );
    blocks.push("");
  }
  blocks.push("Platform schema freshness:", "");
  for (const p of report.platforms) {
    if (p.platform === "opencode") blocks.push(formatOpencodeSection(p));
    else if (p.platform === "claude-code") blocks.push(formatClaudeCodeSection(p));
    else if (p.platform === "codex") blocks.push(formatCodexSection(p));
    else if (p.platform === "kiro") blocks.push(formatKiroSection(p));
    else {
      const _exhaustive: never = p;
      throw new Error(`unhandled platform: ${JSON.stringify(p)}`);
    }
    blocks.push("");
  }
  if (report.modelResolution) {
    blocks.push(formatModelResolutionSection(report.modelResolution));
    blocks.push("");
  }
  if (report.workspace) {
    blocks.push(formatWorkspaceSection(report.workspace));
    blocks.push("");
  }
  if (report.atlassianAuth) {
    blocks.push(formatAtlassianAuthSection(report.atlassianAuth));
    blocks.push("");
  }
  if (report.skillDrift) {
    blocks.push(formatSkillDriftSection(report.skillDrift));
    blocks.push("");
  }
  if (report.agentDrift) {
    blocks.push(formatAgentDriftSection(report.agentDrift));
    blocks.push("");
  }
  if (report.agentRequiredSkills) {
    blocks.push(formatAgentRequiredSkillsSection(report.agentRequiredSkills));
    blocks.push("");
  }
  if (report.registryHygiene) {
    blocks.push(formatRegistryHygieneSection(report.registryHygiene));
    blocks.push("");
  }
  if (report.remoteCatalogs) {
    blocks.push(formatRemoteCatalogsSection(report.remoteCatalogs));
    blocks.push("");
  }
  if (report.duplicateCatalogs) {
    blocks.push(formatDuplicateCatalogsSection(report.duplicateCatalogs));
    blocks.push("");
  }
  if (report.knowledgeRefresh) {
    blocks.push(formatKnowledgeRefreshSection(report.knowledgeRefresh));
    blocks.push("");
  }
  if (report.knowledgeCompile) {
    blocks.push(formatKnowledgeCompileSection(report.knowledgeCompile));
    blocks.push("");
  }
  if (report.mcpSpawnCommands) {
    blocks.push(formatMcpSpawnSection(report.mcpSpawnCommands));
    blocks.push("");
  }
  if (report.mcpDeps) {
    blocks.push(formatMcpDepsSection(report.mcpDeps));
    blocks.push("");
  }
  if (report.lazyFetch) {
    blocks.push(formatLazyFetchSection(report.lazyFetch));
    blocks.push("");
  }
  if (report.urlRouting) {
    blocks.push(formatUrlRoutingSection(report.urlRouting));
    blocks.push("");
  }
  if (report.knowledgeConsistency) {
    blocks.push(formatKnowledgeConsistencySection(report.knowledgeConsistency));
    blocks.push("");
  }
  blocks.push("Run `smith doctor --json` for machine-readable output.");
  blocks.push("Run `smith doctor --offline` to skip the live OpenCode fetch.");
  return blocks.join("\n");
}

/**
 * Footer hints printed in default mode (both TTY and non-TTY).
 * Suppressed in --quiet and --json modes. The --verbose mode uses
 * formatReport's own 2-line footer (no --verbose hint, because the user
 * already passed --verbose).
 */
export const DEFAULT_FOOTER_LINES = [
  "Run `smith doctor --verbose` for full details.",
  "Run `smith doctor --json` for machine-readable output.",
  "Run `smith doctor --offline` to skip the live OpenCode fetch.",
] as const;

/**
 * Default-mode renderer when stdout is a TTY (so the spinner already
 * printed the summary lines via ora). Returns only the auto-expanded
 * warn/error detail block (if any) followed by the 3-line footer.
 * No trailing newline. Sections with status ok/skipped never expand.
 */
export function formatFailuresOnly(
  report: DoctorReport,
  summaries: readonly CapturedSectionSummary[],
): string {
  const detailBlocks = buildDetailBlocks(report, summaries);
  const parts: string[] = [];
  if (detailBlocks.length > 0) {
    parts.push(...detailBlocks, "");
  }
  parts.push(...DEFAULT_FOOTER_LINES);
  return parts.join("\n");
}

/**
 * Default-mode renderer when stdout is NOT a TTY (no spinner ran).
 * Emits the static summary lines (one per captured section, prefixed
 * with the same icons ora would have used) followed by
 * formatFailuresOnly's output. No trailing newline.
 */
export function formatReportCompact(
  report: DoctorReport,
  summaries: readonly CapturedSectionSummary[],
): string {
  const summaryLines = summaries.map((s) => `${iconFor(s.status)} ${s.summary}`);
  const tail = formatFailuresOnly(report, summaries);
  // Always separate the summary block from the tail with a blank line.
  return `${summaryLines.join("\n")}\n\n${tail}`;
}

function buildDetailBlocks(
  report: DoctorReport,
  summaries: readonly CapturedSectionSummary[],
): string[] {
  const out: string[] = [];
  for (const s of summaries) {
    if (s.status !== "warn" && s.status !== "error") continue;
    const detail = renderSectionDetail(report, s.id);
    if (!detail) continue;
    if (out.length > 0) out.push("");
    out.push(`${iconFor(s.status)} ${s.label} (${s.status}):`);
    out.push(indentBlock(detail, 2));
  }
  return out;
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}

function iconFor(status: CapturedSectionSummary["status"]): string {
  switch (status) {
    case "ok":
      return "✔";
    case "warn":
      return "⚠";
    case "error":
      return "✖";
    case "skipped":
      return "ℹ";
  }
}

function renderSectionDetail(
  report: DoctorReport,
  id: CapturedSectionSummary["id"],
): string | null {
  switch (id) {
    case "opencode": {
      const p = report.platforms.find((x) => x.platform === "opencode");
      return p ? formatOpencodeSection(p) : null;
    }
    case "claude-code": {
      const p = report.platforms.find((x) => x.platform === "claude-code");
      return p ? formatClaudeCodeSection(p) : null;
    }
    case "codex": {
      const p = report.platforms.find((x) => x.platform === "codex");
      return p && p.platform === "codex" ? formatCodexSection(p) : null;
    }
    case "kiro": {
      const p = report.platforms.find((x) => x.platform === "kiro");
      return p && p.platform === "kiro" ? formatKiroSection(p) : null;
    }
    case "model-resolution":
      return report.modelResolution ? formatModelResolutionCompact(report.modelResolution) : null;
    case "workspace":
      return report.workspace ? formatWorkspaceSection(report.workspace) : null;
    case "atlassian-auth":
      return report.atlassianAuth ? formatAtlassianAuthSection(report.atlassianAuth) : null;
    case "skill-drift":
      return report.skillDrift ? formatSkillDriftSection(report.skillDrift) : null;
    case "agent-drift":
      return report.agentDrift ? formatAgentDriftSection(report.agentDrift) : null;
    case "agent-required-skills":
      return report.agentRequiredSkills
        ? formatAgentRequiredSkillsSection(report.agentRequiredSkills)
        : null;
    case "registry-hygiene":
      return report.registryHygiene ? formatRegistryHygieneSection(report.registryHygiene) : null;
    case "remote-catalogs":
      return report.remoteCatalogs ? formatRemoteCatalogsSection(report.remoteCatalogs) : null;
    case "duplicate-catalogs":
      return report.duplicateCatalogs
        ? formatDuplicateCatalogsSection(report.duplicateCatalogs)
        : null;
    case "knowledge-refresh":
      return report.knowledgeRefresh
        ? formatKnowledgeRefreshSection(report.knowledgeRefresh)
        : null;
    case "knowledge-compile":
      return report.knowledgeCompile
        ? formatKnowledgeCompileSection(report.knowledgeCompile)
        : null;
    case "mcp-spawn-commands":
      return report.mcpSpawnCommands ? formatMcpSpawnSection(report.mcpSpawnCommands) : null;
    case "mcp-deps":
      return report.mcpDeps ? formatMcpDepsSection(report.mcpDeps) : null;
    case "lazy-fetch":
      return report.lazyFetch ? formatLazyFetchSection(report.lazyFetch) : null;
    case "url-routing":
      return report.urlRouting ? formatUrlRoutingSection(report.urlRouting) : null;
    case "knowledge-prompt-disk-consistency":
      return report.knowledgeConsistency
        ? formatKnowledgeConsistencySection(report.knowledgeConsistency)
        : null;
    default: {
      const _exhaustive: never = id;
      throw new Error(`unhandled section id: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Default-mode (auto-expanded) renderer for the model-resolution section.
 * Shows only user-actionable lines — stale installed agents and installed
 * agents whose platform can't run them. The full readiness + tier-preview
 * matrix is `--verbose`-only (see formatModelResolutionSection).
 */
export function formatModelResolutionCompact(
  mr: NonNullable<DoctorReport["modelResolution"]>,
): string {
  const out: string[] = ["Model resolution:"];
  for (const a of mr.installedAgents) {
    if (a.platform === "opencode" && a.inLiveList === false) {
      out.push(`  [${a.platform}] ${a.agent}  model: ${a.model}  [X] NOT in live list`);
      out.push(`            -> re-run \`smith agent install\``);
    }
  }
  for (const a of mr.installedAgents) {
    const st = mr.platforms[a.platform]?.status;
    if (st === "unauthenticated" || st === "cli-not-installed") {
      const why = st === "cli-not-installed" ? "CLI not installed" : "not authenticated";
      const fix = st === "cli-not-installed" ? "install the platform CLI" : "authenticate the platform CLI";
      out.push(`  [${a.platform}] ${a.agent}: platform ${why}`);
      out.push(`            -> ${fix} (\`smith doctor --verbose\` for details)`);
    }
  }
  if (out.length === 1) out.push("  See \`smith doctor --verbose\` for details.");
  return out.join("\n");
}

export function formatModelResolutionSection(
  mr: NonNullable<DoctorReport["modelResolution"]>,
): string {
  const out: string[] = ["Model resolution:"];
  out.push(`  OpenCode CLI:   ${mr.opencodeCliPath ?? "not found"}`);
  out.push(
    `  Models cached:  ${mr.liveModelCount === null ? "unavailable" : `${mr.liveModelCount} from live list`}`,
  );
  for (const f of mr.curatedFallbacks) {
    const mark = f.inLiveList ? "[ok] in live list" : "[X] NOT in live list";
    out.push(`  Curated ${f.tier} fallback: ${f.value}  ${mark}`);
  }

  // Detected providers
  if (mr.detectedProviders.length > 0) {
    out.push(`  Detected providers: ${mr.detectedProviders.join(", ")}`);
  }

  // Preference order
  if (mr.preferenceOrder.length > 0) {
    out.push("  Preference order:");
    for (let i = 0; i < mr.preferenceOrder.length; i++) {
      const e = mr.preferenceOrder[i]!;
      out.push(`    ${i + 1}. ${e.provider.padEnd(18)} (from ${e.source})`);
    }
  }

  // Per-platform readiness matrix
  out.push("");
  out.push("  Platform readiness:");
  const PLATFORM_LABELS: Record<string, string> = {
    opencode: "OpenCode",
    "claude-code": "Claude Code",
    codex: "Codex",
    kiro: "Kiro",
  };
  const STATUS_GLYPH = {
    authenticated: "[ok] authenticated",
    unauthenticated: "[!] unauthenticated",
    "cli-not-installed": "[ ] not installed",
    unknown: "[?] unknown",
  } as const;
  const platforms = mr.platforms;
  for (const id of ["opencode", "claude-code", "codex", "kiro"] as const) {
    const p = platforms[id];
    const label = (PLATFORM_LABELS[id] ?? id).padEnd(12);
    const status = STATUS_GLYPH[p.status];
    const detail = p.detail ? `  ${p.detail}` : "";
    out.push(`    ${label} ${status}${detail}`);
  }

  // Tier resolution preview — per-platform matrix.
  if (mr.tierPreview.length > 0) {
    out.push("");
    out.push("  Tier resolution preview (what each platform's resolver returns):");
    // Column header line for legibility.
    const cols = (
      ["opencode", "claude-code", "codex", "kiro"] as const
    ).map((id) => (PLATFORM_LABELS[id] ?? id).padEnd(14));
    out.push(`    ${"tier".padEnd(10)} ${cols.join(" ")}`);
    for (const t of mr.tierPreview) {
      const cells = (["opencode", "claude-code", "codex", "kiro"] as const).map((id) => {
        const v = t.perPlatform?.[id];
        const cell = v ?? "—";
        return cell.padEnd(14);
      });
      out.push(`    ${t.tier.padEnd(10)} ${cells.join(" ")}`);
    }
    // Surface OpenCode-specific failure messages so users still see the hint.
    for (const t of mr.tierPreview) {
      if (t.source === "failed" && t.message) {
        out.push(`    [${t.tier}] OpenCode: ${t.message}`);
      }
    }
  }

  if (mr.installedAgents.length > 0) {
    out.push("");
    out.push("Installed agents (model literals):");
    for (const a of mr.installedAgents) {
      const mark =
        a.inLiveList === null
          ? "(not checked)"
          : a.inLiveList
            ? "[ok] in live list"
            : "[X] NOT in live list - re-run 'smith agent install'";
      out.push(`  [${a.platform}] ${a.agent}  model: ${a.model}  ${mark}`);
    }
  }
  if (mr.hasStale) {
    out.push("");
    out.push("Status: 1+ agents have stale model resolution. Re-install to fix.");
  }
  return out.join("\n");
}

export function formatWorkspaceSection(ws: WorkspaceVersionStatus): string {
  // Header style mirrors peer sections (`OpenCode:`, `Claude Code:`, `Codex:`).
  const lines: string[] = ["Workspace:"];
  switch (ws.status) {
    case "current":
      lines.push("  Status: Workspace up to date");
      break;
    case "behind":
      lines.push(
        ws.commitsBehind === null
          ? "  Status: Workspace behind (count unavailable)"
          : `  Status: Workspace behind by ${ws.commitsBehind} commit${ws.commitsBehind === 1 ? "" : "s"}`,
      );
      lines.push("  Hint:   Run `smith update` to pull the latest commits from origin/main.");
      break;
    case "ahead":
      lines.push(
        ws.commitsAhead === null
          ? "  Status: Workspace ahead (count unavailable)"
          : `  Status: Workspace ahead by ${ws.commitsAhead} commit${ws.commitsAhead === 1 ? "" : "s"}`,
      );
      break;
    case "diverged":
      lines.push(
        `  Status: Workspace diverged: ${ws.commitsBehind} behind, ${ws.commitsAhead} ahead`,
      );
      lines.push(
        "  Hint:   Resolve manually (e.g. `git rebase origin/main`) before running `smith update`.",
      );
      break;
    case "unknown":
      switch (ws.reason) {
        case "offline-skipped":
          lines.push("  Status: Workspace check skipped (offline)");
          break;
        case "network-error":
          lines.push("  Status: Workspace check failed (network error)");
          break;
        case "no-local-head":
          lines.push("  Status: Workspace check inconclusive (no HEAD)");
          break;
        case "non-git":
        case "no-workspace":
          lines.push("  Status: Workspace check skipped (not a git checkout)");
          break;
      }
      break;
  }
  return lines.join("\n");
}

export function formatAtlassianAuthSection(auth: AtlassianAuthReport): string {
  const lines: string[] = ["Atlassian auth:"];
  if (auth.status === "not-applicable") {
    lines.push("  Status: not used (no Confluence/Jira knowledge sources; atlassian-skills not installed)");
    lines.push("  To enable Confluence/Jira knowledge sources later,");
    lines.push(`          create ${join(stateHome(), ".env")} with SMITH_ATLASSIAN_EMAIL / _API_TOKEN / _BASE_URL.`);
    return lines.join("\n");
  }
  if (auth.status === "configured") {
    lines.push(`  Status:  configured (source: ${auth.source})`);
    lines.push(`  Base URL: ${auth.baseUrl}`);
    if (auth.atlassianSkills) {
      appendAtlassianSkillsLines(lines, auth.atlassianSkills);
    }
    return lines.join("\n");
  }
  if (auth.status === "incomplete") {
    lines.push(
      `  Status: incomplete (source: ${auth.source} — credentials present, workspace URL missing)`,
    );
    lines.push("  Hint:   Confluence/Jira sources will fail at fetch time until you set");
    lines.push(
      `          SMITH_ATLASSIAN_BASE_URL to your workspace URL (e.g. https://acme.atlassian.net)`,
    );
    lines.push(`          in your process env or ${join(stateHome(), ".env")}.`);
    lines.push(
      "          Atlassian Cloud instances are workspace-scoped — there is no global default.",
    );
    if (auth.atlassianSkills) {
      appendAtlassianSkillsLines(lines, auth.atlassianSkills);
    }
    return lines.join("\n");
  }
  // status === "missing"
  lines.push("  Status: not configured");
  lines.push("  Hint:   To enable Confluence/Jira knowledge sources,");
  lines.push(`          create ${join(stateHome(), ".env")} with:`);
  lines.push("            SMITH_ATLASSIAN_EMAIL=<your-email>");
  lines.push("            SMITH_ATLASSIAN_API_TOKEN=<your-token>");
  lines.push("            SMITH_ATLASSIAN_BASE_URL=https://<workspace>.atlassian.net");
  lines.push("");
  // Indent the canonical token-creation steps to align with the doctor
  // section's hint-line indent.
  for (const step of tokenCreationInstructions()) {
    lines.push(`          ${step}`);
  }
  return lines.join("\n");
}

function appendAtlassianSkillsLines(
  lines: string[],
  skills: import("./types").AtlassianSkillsRuntimeStatus,
): void {
  lines.push("");
  lines.push("  atlassian-skills installed:");
  switch (skills.bridgeStatus) {
    case "in-sync":
      lines.push("    Bridge:   ✓ JIRA_*/CONFLUENCE_* in sync with SMITH_ATLASSIAN_*");
      break;
    case "not-bridged":
      lines.push("    Bridge:   ! per-product env vars not set");
      lines.push(
        "    Hint:     Re-run `smith init-user` (or save in the GUI) to write JIRA_*/CONFLUENCE_*",
      );
      break;
    case "drift":
      lines.push("    Bridge:   ! drift detected");
      for (const r of skills.bridgeReasons ?? []) lines.push(`              - ${r}`);
      lines.push("    Hint:     Re-run `smith init-user` to refresh the bridge");
      break;
  }
  const py = skills.python;
  if (py.binary && py.versionOk) {
    lines.push(`    Python:   ✓ ${py.binary} ${py.version} on PATH`);
    if (!py.packagesAvailable.requests || !py.packagesAvailable.dotenv) {
      const missing = [
        py.packagesAvailable.requests ? null : "requests",
        py.packagesAvailable.dotenv ? null : "python-dotenv",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`    Packages: ! missing: ${missing}`);
      lines.push(`    Hint:     Run \`pip install ${missing.replace(",", "")}\``);
    } else {
      lines.push("    Packages: ✓ requests, python-dotenv importable");
    }
  } else {
    lines.push("    Python:   ! python3 (or python ≥3.8) not found on PATH");
    lines.push("    Hint:     Install Python 3.8+ from https://python.org");
  }
}

/**
 * Render the installed-skill drift section. One line per
 * installed skill plus a remediation hint when something is wrong.
 *
 * Output shape (one of):
 *   Installed skills:
 *     [ok]    <name>
 *     [drift] <name>          (run `smith skill update <name>`)
 *     [missing] <name>        (manual delete; re-run `smith skill update <name>`)
 *     [src!]   <name>         (source dir gone: <sourceDir>)
 *
 * The section is informational: drift never bumps the doctor exit code
 * (a user may legitimately tweak an installed skill until the next
 * `smith skill update`). The remediation hint is the value-add.
 */
export function formatSkillDriftSection(sd: SkillDriftReport): string {
  const lines: string[] = ["Installed skills:"];
  if (sd.entries.length === 0) {
    lines.push("  (none tracked)");
    return lines.join("\n");
  }
  for (const e of sd.entries) {
    switch (e.status) {
      case "ok":
        lines.push(`  [ok]      ${e.name}`);
        break;
      case "drift":
        lines.push(`  [drift]   ${e.name}`);
        lines.push(`            -> run \`smith skill update ${e.name}\` to overwrite local edits`);
        break;
      case "missing":
        lines.push(`  [missing] ${e.name}`);
        lines.push(
          `            -> dest gone (${e.checkedDest}); run \`smith skill update ${e.name}\``,
        );
        break;
      case "source-missing":
        lines.push(`  [src!]    ${e.name}`);
        lines.push(`            -> source missing at ${e.sourceDir}; reinstall from a new source`);
        break;
    }
  }
  return lines.join("\n");
}

export function formatAgentDriftSection(r: AgentDriftReport): string {
  const lines: string[] = ["Installed agents:"];
  if (r.entries.length === 0) {
    lines.push("  (none tracked)");
    return lines.join("\n");
  }
  for (const e of r.entries) {
    switch (e.status) {
      case "ok":
        lines.push(`  [ok]      ${e.name} (${e.platform})`);
        break;
      case "drift":
        lines.push(`  [drift]   ${e.name} (${e.platform})`);
        lines.push(`            -> on-disk file edited since install; run \`smith agent install ${e.name}\``);
        break;
      case "missing":
        lines.push(`  [missing] ${e.name} (${e.platform})`);
        lines.push(`            -> installed file gone (${e.path}); run \`smith agent install ${e.name}\``);
        break;
    }
  }
  return lines.join("\n");
}

/**
 * Render the agent ↔ required-skill report.
 *
 * OK case: a single line confirming all agents are satisfied.
 * Warn case: per-agent block listing each missing skill with a
 * `smith skill install <ref>` remediation hint. Catalog-qualified entries
 * render as `<catalog>/<name>`; bare entries render as just `<name>`.
 *
 * Informational: missing required skills never bump the doctor exit code.
 */
export function formatAgentRequiredSkillsSection(r: AgentRequiredSkillsReport): string {
  const lines: string[] = ["Required skills:"];
  if (r.status === "ok") {
    lines.push("  Status: all agents satisfied");
    return lines.join("\n");
  }
  lines.push(`  Status: missing for ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}`);
  for (const a of r.agents) {
    lines.push(`  ${a.name}:`);
    for (const m of a.missing) {
      const ref = m.catalog ? `${m.catalog}/${m.name}` : m.name;
      lines.push(`    [missing] ${m.name}`);
      lines.push(`              -> run \`smith skill install ${ref}\``);
    }
  }
  return lines.join("\n");
}

/**
 * Render the registry hygiene section. Informational only —
 * lists warnings and errors discovered while inspecting each
 * registered agent/skill catalog. The "ok" case still prints a
 * status line so users can confirm the check ran.
 */
export function formatRegistryHygieneSection(r: RegistryHygieneReport): string {
  const lines: string[] = ["Registry hygiene:"];
  if (r.warnings.length === 0 && r.errors.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  for (const w of r.warnings) lines.push(`  [warn]  ${w}`);
  for (const e of r.errors) lines.push(`  [error] ${e}`);
  return lines.join("\n");
}

/**
 * Render the remote-catalogs section (v1-task C3.14). Informational
 * only — lists drift and stale-check findings for each remote-backed
 * catalog. The "ok" branch still prints a status line so users can
 * confirm the check ran.
 */
export function formatRemoteCatalogsSection(r: RemoteCatalogsReport): string {
  const lines: string[] = ["Remote catalogs:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  for (const f of r.findings) {
    const remediation =
      f.finding === "catalog-behind-remote"
        ? `smith ${f.kind} sync ${f.label}`
        : `smith ${f.kind} sync --check ${f.label}`;
    lines.push(`  [warn]  ${f.kind} catalog '${f.label}': ${f.detail}`);
    lines.push(`           → ${remediation}`);
  }
  return lines.join("\n");
}

/**
 * Render the duplicate-catalogs section (v1-task RC2-10). Informational
 * only — lists clusters of registry entries pointing at the same
 * upstream repo (modulo URL normalization). Each cluster prints the
 * normalized URL once, then the member entries with their registry kind
 * + label + rootPath so users can decide which copy to keep.
 *
 * Remediation hint suggests `smith {agent,skill} unregister` per
 * member; we deliberately don't recommend WHICH one to drop — that's
 * a user judgement call (e.g. they may want to keep the linked
 * checkout and drop the managed clone, or vice versa).
 */
export function formatDuplicateCatalogsSection(r: DuplicateCatalogsReport): string {
  const lines: string[] = ["Duplicate catalogs:"];
  if (r.clusters.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  for (const cluster of r.clusters) {
    lines.push(`  [warn]  ${cluster.normalizedUrl}`);
    for (const m of cluster.members) {
      lines.push(`           - ${m.registryKind} '${m.label}' (${m.rootPath})`);
    }
    lines.push(
      `           → review and run \`smith <kind> unregister <label>\` to drop duplicates`,
    );
  }
  return lines.join("\n");
}

/**
 * Render the knowledge-refresh detection section. Read-only: lists each
 * finding with a human-readable line. Repair (`--fix-knowledge-refresh`)
 * is wired by a separate task; the hints here point at the remediation
 * command users will eventually have.
 */
export function formatKnowledgeRefreshSection(r: RefreshHooksReport): string {
  const lines: string[] = ["Knowledge refresh:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  lines.push(`  Status: ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`);
  for (const f of r.findings) lines.push(`  ${formatRefreshFinding(f)}`);
  return lines.join("\n");
}

function formatRefreshFinding(f: RefreshFinding): string {
  switch (f.kind) {
    case "missing-hook":
      return `[missing-hook]        ${f.agent} on ${f.platform} — consented but no on-disk hook references this agent`;
    case "orphaned-consent":
      return `[orphaned-consent]    ${f.agent} on ${f.platform} — manifest consents but agent is not installed for this platform`;
    case "stale-consent-uninstalled":
      return `[stale-consent]       ${f.agent} on ${f.platform} — consent recorded but ${f.platform} CLI not installed (run \`smith doctor --fix-knowledge-refresh\` to clean up)`;
    case "corrupt-cache":
      return `[corrupt-cache]       ${f.agent}/${f.sourceId} — refresh cache entry is unparseable or off-schema`;
    case "unmanaged-codex-hooks":
      return `[unmanaged-codex-hooks] ${f.path} — pre-existing user file lacks the _smith_managed sentinel`;
  }
}

/**
 * Render the knowledge-compile drift section. Read-only: lists each
 * finding with a human-readable line. Repair is handled by the CLI's
 * `--fix-knowledge-compile` flag (which re-runs `smith knowledge compile`
 * for each affected agent).
 */
export function formatKnowledgeCompileSection(r: KnowledgeCompileReport): string {
  const lines: string[] = ["Knowledge compile:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  lines.push(`  Status: ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`);
  for (const f of r.findings) lines.push(`  ${formatKnowledgeCompileFinding(f)}`);
  lines.push("  Fix:    smith doctor --fix-knowledge-compile");
  return lines.join("\n");
}

function formatKnowledgeCompileFinding(f: KnowledgeCompileFinding): string {
  switch (f.kind) {
    case "missing-manifest":
      return `[missing-manifest] ${f.agent} — compile.progressive=true but compile-manifest.json is absent (or unparseable)`;
    case "drift":
      return `[drift]            ${f.agent} — recorded ${f.recordedHash.slice(0, 8)} != fresh ${f.currentHash.slice(0, 8)}`;
  }
}

/**
 * Render the mcp-spawn-commands audit section. Read-only: lists each
 * fragile entry with the platform, server name, and the absolute path
 * the auto-fix would substitute (or `(unresolvable)` when neither
 * `process.argv[1]` realpath nor `which <command>` could resolve it,
 * in which case the user is told to install the binary first).
 */
export function formatMcpSpawnSection(r: McpSpawnSection): string {
  const lines: string[] = ["MCP spawn commands:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  lines.push(`  Status: ${r.findings.length} fragile entr${r.findings.length === 1 ? "y" : "ies"}`);
  for (const f of r.findings) lines.push(`  ${formatMcpSpawnFinding(f)}`);
  lines.push("  Fix:    smith doctor --fix-mcp-commands");
  return lines.join("\n");
}

function formatMcpSpawnFinding(f: McpSpawnFinding): string {
  const fix = f.resolvedAbsolute ?? "(unresolvable)";
  return `[fragile-spawn] ${f.platform} / ${f.serverName} — command="${f.command}" → ${fix}`;
}

/**
 * Render the mcp-deps audit section. Read-only: lists each missing
 * dependency with its severity (error for required, warning for peer)
 * and the agent that declared it. There is no auto-fix — `smith` does
 * not install MCP servers; the user installs them via their platform's
 * own configuration UI.
 */
export function formatMcpDepsSection(
  r: NonNullable<DoctorReport["mcpDeps"]>,
): string {
  const lines: string[] = ["MCP dependencies:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const warnings = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} required missing`);
  if (warnings > 0) parts.push(`${warnings} peer missing`);
  lines.push(`  Status: ${parts.join(", ")}`);
  for (const f of r.findings) {
    const icon = f.severity === "error" ? "✗" : "⚠";
    const note =
      f.kind === "required"
        ? `requires '${f.server}' — install the MCP server to satisfy the dependency`
        : `expects '${f.server}' (peer) — install for full functionality`;
    lines.push(`  ${icon} ${f.agent} ${note}`);
  }
  return lines.join("\n");
}

/**
 * Render the lazy-fetch audit section. Read-only: lists each lazy URL
 * source whose runtime fetch path is broken (no via routing AND no target
 * with a built-in fetch tool, or via routing through an MCP server that
 * isn't configured). There is no auto-fix — the user either wires `via:`
 * or installs the missing MCP server.
 */
export function formatLazyFetchSection(
  r: NonNullable<DoctorReport["lazyFetch"]>,
): string {
  const lines: string[] = ["Lazy URL fetch:"];
  if (r.findings.length === 0) {
    lines.push("  Status: ok");
    return lines.join("\n");
  }
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const warnings = r.findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} unreachable`);
  if (warnings > 0) parts.push(`${warnings} via missing`);
  lines.push(`  Status: ${parts.join(", ")}`);
  for (const f of r.findings) {
    const icon = f.severity === "error" ? "✗" : "⚠";
    lines.push(`  ${icon} ${f.agent}/${f.sourceId}: ${f.message}`);
  }
  return lines.join("\n");
}

/**
 * Render the url-routing section. Read-only: enumerates every pattern
 * smith would auto-route, grouped by source layer (curated, advertised,
 * learned), and lists any pattern claimed by more than one server/tool
 * pair as an ambiguity. There is no auto-fix — ambiguities are
 * informational; the resolver picks the most-authoritative layer at
 * fetch time.
 */
export function formatUrlRoutingSection(
  r: NonNullable<DoctorReport["urlRouting"]>,
): string {
  const lines: string[] = ["URL routing:"];
  if (r.entries.length === 0) {
    lines.push("  Status: no routes registered");
    return lines.join("\n");
  }
  const ambiguousPatterns = new Set(r.ambiguities.map((a) => a.urlPattern));
  const layerLabel: Record<"curated" | "_meta" | "cache", string> = {
    curated: "curated",
    _meta: "advertised",
    cache: "learned",
  };
  for (const layer of ["curated", "_meta", "cache"] as const) {
    const layerEntries = r.entries.filter((e) => e.source === layer);
    if (layerEntries.length === 0) continue;
    lines.push(`  ${layerLabel[layer]}:`);
    for (const e of layerEntries) {
      const flag = ambiguousPatterns.has(e.urlPattern) ? " [ambiguous]" : "";
      lines.push(`    ${e.urlPattern}  →  ${e.server}.${e.tool}${flag}`);
    }
  }
  if (r.ambiguities.length > 0) {
    lines.push("");
    lines.push(
      `  Ambiguities: ${r.ambiguities.length} pattern${r.ambiguities.length === 1 ? "" : "s"} claimed by more than one server/tool`,
    );
    for (const a of r.ambiguities) {
      lines.push(`    ${a.urlPattern}`);
      for (const c of a.claimants) {
        lines.push(`      - ${c.server}.${c.tool} (${c.source})`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render the knowledge-prompt-disk-consistency section. Per agent/target,
 * shows indexed vs present file counts and a fix command when drift exists.
 */
export function formatKnowledgeConsistencySection(
  r: import("./check-knowledge-consistency").KnowledgeConsistencyReport,
): string {
  const lines: string[] = ["Knowledge prompt-disk consistency:"];
  if (r.status === "skipped") {
    lines.push("  Status: no agents with knowledge index");
    if (r.orphanTrees.length > 0) {
      lines.push("");
      lines.push("  orphan trees from pre-fix refresh-source.ts (safe to remove):");
      for (const p of r.orphanTrees) {
        lines.push(`    ${p}`);
        lines.push(`    fix: rm -rf ${p}`);
      }
    }
    return lines.join("\n");
  }
  if (r.status === "ok") {
    lines.push("  Status: all files present");
    if (r.orphanTrees.length > 0) {
      lines.push("");
      lines.push("  orphan trees from pre-fix refresh-source.ts (safe to remove):");
      for (const p of r.orphanTrees) {
        lines.push(`    ${p}`);
        lines.push(`    fix: rm -rf ${p}`);
      }
    }
    return lines.join("\n");
  }
  for (const a of r.agents) {
    const hasDrift =
      a.missingFiles.length > 0 ||
      a.brokenSymlinks.length > 0 ||
      a.manifestMismatchFiles.length > 0;
    const icon = hasDrift ? "✗" : "✔";
    lines.push(
      `  ${icon} agent ${a.agentName} (${a.target}): ${a.indexedFiles} indexed files, ${a.presentFiles} present`,
    );
    if (hasDrift) {
      lines.push(`    fix: ${a.fix}`);
    }
  }
  if (r.orphanTrees.length > 0) {
    lines.push("");
    lines.push("  orphan trees from pre-fix refresh-source.ts (safe to remove):");
    for (const p of r.orphanTrees) {
      lines.push(`    ${p}`);
      lines.push(`    fix: rm -rf ${p}`);
    }
  }
  return lines.join("\n");
}
