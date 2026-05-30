import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FOOTER_LINES,
  formatClaudeCodeSection,
  formatCodexSection,
  formatFailuresOnly,
  formatModelResolutionCompact,
  formatOpencodeSection,
  formatReport,
  formatReportCompact,
  formatWorkspaceSection,
} from "../../../src/core/freshness/format";
import type { CapturedSectionSummary } from "../../../src/core/freshness/run-doctor";
import type { DoctorReport } from "../../../src/core/freshness/types";
import type { WorkspaceVersionStatus } from "../../../src/io/workspace-version";

const baseClaude = {
  platform: "claude-code" as const,
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools",
  notes: "Verified.",
  status: "manual" as const,
};

const baseCodex = {
  platform: "codex" as const,
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "https://github.com/openai/codex",
  notes: "Best-effort.",
  status: "manual" as const,
};

describe("formatReport", () => {
  test("fresh OpenCode report mentions both vendored date and live schema id", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [
        {
          platform: "opencode",
          vendoredDate: "2026-05-01",
          liveSchemaId: "https://opencode.ai/schema.json",
          liveVersion: "1.14.28",
          status: "fresh",
          sourceUrl: "https://opencode.ai/config.json",
        },
        baseClaude,
        baseCodex,
      ],
    };
    const out = formatReport(report);
    expect(out).toContain("OpenCode");
    expect(out).toContain("2026-05-01");
    expect(out).toContain("FRESH");
    expect(out).toContain("Claude Code");
    expect(out).toContain("Codex");
  });

  test("drift OpenCode report includes the headline and a bounded sample of paths", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 1,
      platforms: [
        {
          platform: "opencode",
          vendoredDate: "2026-05-01",
          liveSchemaId: null,
          liveVersion: null,
          status: "drift",
          sourceUrl: "https://opencode.ai/config.json",
          drift: {
            added: ["properties/agent/properties/sandbox", "properties/mcp_call"],
            removed: ["properties/legacy_field"],
            changed: [],
            headline: "2 added, 1 removed",
          },
        },
        baseClaude,
        baseCodex,
      ],
    };
    const out = formatReport(report);
    expect(out).toContain("DRIFT DETECTED");
    expect(out).toContain("2 added, 1 removed");
    expect(out).toContain("properties/agent/properties/sandbox");
    expect(out).toContain("properties/legacy_field");
    expect(out).toMatch(/Action:\s+smith update/);
    expect(out).toMatch(/if drift persists/i);
    expect(out).toMatch(/issues/);
    expect(out).not.toMatch(/the latest agent-smith still drifts/);
    expect(out).not.toMatch(/npm i -g/);
  });

  test("drift report truncates long path lists with (+N more)", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 1,
      platforms: [
        {
          platform: "opencode",
          vendoredDate: "2026-05-01",
          liveSchemaId: null,
          liveVersion: null,
          status: "drift",
          sourceUrl: "https://opencode.ai/config.json",
          drift: {
            added: ["a", "b", "c", "d", "e", "f", "g"],
            removed: [],
            changed: [],
            headline: "7 added",
          },
        },
        baseClaude,
        baseCodex,
      ],
    };
    const out = formatReport(report);
    expect(out).toContain("(+2 more)");
    expect(out).toContain("a");
    expect(out).toContain("e");
    expect(out).not.toContain("      g"); // 7th path (6-space indent) should not appear
  });

  test("manual platform with empty notes shows (none)", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [{ ...baseClaude, notes: "" }],
    };
    const out = formatReport(report);
    expect(out).toContain("(none)");
  });

  test("network-error OpenCode reports the error and the offline-flag hint", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 2,
      platforms: [
        {
          platform: "opencode",
          vendoredDate: "2026-05-01",
          liveSchemaId: null,
          liveVersion: null,
          status: "network-error",
          networkError: "ECONNREFUSED",
          sourceUrl: "https://opencode.ai/config.json",
        },
        baseClaude,
        baseCodex,
      ],
    };
    const out = formatReport(report);
    expect(out).toContain("NETWORK ERROR");
    expect(out).toContain("ECONNREFUSED");
    expect(out).toContain("--offline");
  });

  test("offline-skipped OpenCode says vendored-only and exit code 0", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [
        {
          platform: "opencode",
          vendoredDate: "2026-05-01",
          liveSchemaId: null,
          liveVersion: null,
          status: "offline-skipped",
          sourceUrl: "https://opencode.ai/config.json",
        },
        baseClaude,
        baseCodex,
      ],
    };
    const out = formatReport(report);
    expect(out).toContain("OFFLINE");
  });

  test("manual platforms always include lastVerifiedDate, verifiedAgainstVersion, sourceUrl", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
    };
    const out = formatReport(report);
    expect(out).toContain("2026-04-20");
    expect(out).toContain("claude-code v0.42.0");
    expect(out).toContain("https://docs.anthropic.com");
    expect(out).toContain("2026-04-15");
    expect(out).toContain("codex v0.7.0");
  });
});

describe("formatReport regression guard", () => {
  test("composed output equals concatenated section outputs (with the same separators used today)", () => {
    const opencode = {
      platform: "opencode" as const,
      vendoredDate: "2026-01-01",
      sourceUrl: "https://example.com/schema.json",
      liveSchemaId: "https://opencode.ai/schema.json",
      liveVersion: "1.14.28",
      status: "fresh" as const,
    };
    const claude = {
      platform: "claude-code" as const,
      lastVerifiedDate: "2026-01-01",
      verifiedAgainstVersion: "1.0.0",
      sourceUrl: "https://example.com/claude.json",
      notes: "n/a",
      status: "manual" as const,
    };
    const codex = {
      platform: "codex" as const,
      lastVerifiedDate: "2026-01-01",
      verifiedAgainstVersion: "1.0.0",
      sourceUrl: "https://example.com/codex.json",
      notes: "n/a",
      status: "manual" as const,
    };
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [opencode, claude, codex],
    };
    const composed = formatReport(report);
    const sectionConcat = [
      "Platform schema freshness:",
      "",
      formatOpencodeSection(opencode),
      "",
      formatClaudeCodeSection(claude),
      "",
      formatCodexSection(codex),
      "",
      "Run `smith doctor --json` for machine-readable output.",
      "Run `smith doctor --offline` to skip the live OpenCode fetch.",
    ].join("\n");
    expect(composed).toBe(sectionConcat);
  });
});

describe("formatWorkspaceSection", () => {
  test("renders 'current' status", () => {
    const status: WorkspaceVersionStatus = { status: "current" };
    const out = formatWorkspaceSection(status);
    expect(out).toContain("Workspace");
    expect(out).toContain("up to date");
  });

  test("renders 'behind' status with commit count", () => {
    const status: WorkspaceVersionStatus = { status: "behind", commitsBehind: 3 };
    const out = formatWorkspaceSection(status);
    expect(out).toContain("behind");
    expect(out).toContain("3");
  });

  test("renders 'ahead' status with commit count", () => {
    const status: WorkspaceVersionStatus = { status: "ahead", commitsAhead: 2 };
    const out = formatWorkspaceSection(status);
    expect(out).toContain("ahead");
    expect(out).toContain("2");
  });

  test("renders 'diverged' status with both counts", () => {
    const status: WorkspaceVersionStatus = {
      status: "diverged",
      commitsBehind: 4,
      commitsAhead: 5,
    };
    const out = formatWorkspaceSection(status);
    expect(out).toContain("diverged");
    expect(out).toContain("4");
    expect(out).toContain("5");
  });

  test("renders 'unknown' offline-skipped status", () => {
    const status: WorkspaceVersionStatus = { status: "unknown", reason: "offline-skipped" };
    const out = formatWorkspaceSection(status);
    expect(out).toMatch(/skipped/i);
    expect(out).toMatch(/offline/i);
  });

  test("renders 'unknown' network-error status", () => {
    const status: WorkspaceVersionStatus = { status: "unknown", reason: "network-error" };
    const out = formatWorkspaceSection(status);
    expect(out).toMatch(/failed/i);
    expect(out).toMatch(/network/i);
  });

  test("renders 'unknown' no-local-head status", () => {
    const status: WorkspaceVersionStatus = { status: "unknown", reason: "no-local-head" };
    const out = formatWorkspaceSection(status);
    expect(out).toMatch(/inconclusive/i);
    expect(out).toMatch(/HEAD/);
  });

  test("renders 'unknown' non-git status", () => {
    const status: WorkspaceVersionStatus = { status: "unknown", reason: "non-git" };
    const out = formatWorkspaceSection(status);
    expect(out).toMatch(/skipped/i);
    expect(out).toMatch(/not a git checkout/i);
  });

  test("renders 'unknown' no-workspace status", () => {
    const status: WorkspaceVersionStatus = { status: "unknown", reason: "no-workspace" };
    const out = formatWorkspaceSection(status);
    expect(out).toMatch(/skipped/i);
    expect(out).toMatch(/not a git checkout/i);
  });
});

describe("formatReport: atlassianAuth section", () => {
  test("renders configured + source", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: {
        status: "configured",
        source: "file-smith",
        baseUrl: "https://acme.atlassian.net",
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Atlassian auth/);
    expect(out).toMatch(/configured/);
    expect(out).toMatch(/file-smith/);
  });

  test("renders missing + remediation", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: { status: "missing" },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Atlassian auth/);
    expect(out).toMatch(/not configured/);
    expect(out).toMatch(/SMITH_ATLASSIAN_EMAIL/);
    expect(out).toMatch(/id\.atlassian\.com/);
  });

  test("renders atlassianSkills sub-status with bridge in-sync and Python OK", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: {
        status: "configured",
        source: "file-smith",
        baseUrl: "https://acme.atlassian.net",
        atlassianSkills: {
          installed: true,
          bridgeStatus: "in-sync",
          python: {
            binary: "python3",
            version: "3.11.4",
            versionOk: true,
            packagesAvailable: { requests: true, dotenv: true },
          },
        },
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/atlassian-skills installed/);
    expect(out).toMatch(/Bridge:.*✓/);
    expect(out).toMatch(/Python:.*✓.*python3 3\.11\.4/);
    expect(out).toMatch(/Packages:.*✓/);
  });

  test("renders bridge drift with reasons", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: {
        status: "configured",
        source: "env-smith",
        baseUrl: "https://acme.atlassian.net",
        atlassianSkills: {
          installed: true,
          bridgeStatus: "drift",
          bridgeReasons: [
            "JIRA_URL drift: actual=https://old.net, expected=https://acme.atlassian.net",
          ],
          python: {
            binary: "python3",
            version: "3.11.4",
            versionOk: true,
            packagesAvailable: { requests: true, dotenv: true },
          },
        },
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Bridge:.*! drift detected/);
    expect(out).toMatch(/JIRA_URL drift/);
    expect(out).toMatch(/Re-run.*smith init-user/);
  });

  test("renders Python missing", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: {
        status: "configured",
        source: "file-smith",
        baseUrl: "https://acme.atlassian.net",
        atlassianSkills: {
          installed: true,
          bridgeStatus: "in-sync",
          python: {
            binary: null,
            version: null,
            versionOk: false,
            packagesAvailable: { requests: false, dotenv: false },
          },
        },
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Python:.*! python3.*not found/);
    expect(out).toMatch(/python\.org/);
  });

  test("renders packages missing", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms: [baseClaude, baseCodex],
      atlassianAuth: {
        status: "configured",
        source: "file-smith",
        baseUrl: "https://acme.atlassian.net",
        atlassianSkills: {
          installed: true,
          bridgeStatus: "in-sync",
          python: {
            binary: "python3",
            version: "3.11.4",
            versionOk: true,
            packagesAvailable: { requests: false, dotenv: true },
          },
        },
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Packages:.*! missing: requests/);
  });
});

describe("formatReport: skillDrift section", () => {
  const baseOC = {
    platform: "opencode" as const,
    vendoredDate: "2026-05-01",
    liveSchemaId: null,
    liveVersion: null,
    status: "fresh" as const,
    sourceUrl: "https://opencode.ai/config.json",
  };
  const platforms = [baseOC, baseClaude, baseCodex];

  test("rendered output includes per-skill status lines and remediation hints", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms,
      skillDrift: {
        entries: [
          { name: "ok-one", status: "ok", checkedDest: "/d/ok" },
          {
            name: "drift-one",
            status: "drift",
            checkedDest: "/d/drift",
            recordedHash: "h1",
            currentHash: "h2",
          },
          { name: "miss-one", status: "missing", checkedDest: "/d/miss" },
          { name: "src-gone", status: "source-missing", sourceDir: "/src/gone" },
        ],
      },
    };
    const out = formatReport(report);
    expect(out).toContain("Installed skills:");
    expect(out).toMatch(/\[ok\]\s+ok-one/);
    expect(out).toMatch(/\[drift\]\s+drift-one/);
    expect(out).toContain("smith skill update drift-one");
    expect(out).toMatch(/\[missing\]\s+miss-one/);
    expect(out).toContain("/d/miss");
    expect(out).toMatch(/\[src!\]\s+src-gone/);
    expect(out).toContain("/src/gone");
  });

  test("empty entries renders '(none tracked)'", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms,
      skillDrift: { entries: [] },
    };
    const out = formatReport(report);
    expect(out).toContain("Installed skills:");
    expect(out).toContain("(none tracked)");
  });
});

describe("formatReport: agentRequiredSkills section", () => {
  const baseOC = {
    platform: "opencode" as const,
    vendoredDate: "2026-05-01",
    liveSchemaId: null,
    liveVersion: null,
    status: "fresh" as const,
    sourceUrl: "https://opencode.ai/config.json",
  };
  const platforms = [baseOC, baseClaude, baseCodex];

  test("renders OK line when no missing skills", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms,
      agentRequiredSkills: { status: "ok", agents: [] },
    };
    const out = formatReport(report);
    expect(out).toMatch(/Required skills/i);
    expect(out).toMatch(/all agents satisfied/);
  });

  test("renders missing skills with smith skill install remediation", () => {
    const report: DoctorReport = {
      generatedAt: "2026-05-01T12:00:00.000Z",
      skippedPlatforms: [],
      exitCode: 0,
      platforms,
      agentRequiredSkills: {
        status: "warn",
        agents: [
          {
            name: "team-helper",
            missing: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
          },
        ],
      },
    };
    const out = formatReport(report);
    expect(out).toMatch(/team-helper/);
    expect(out).toMatch(/jira-helper/);
    expect(out).toMatch(/confluence-helper/);
    expect(out).toMatch(/smith skill install team\/jira-helper/);
    expect(out).toMatch(/smith skill install confluence-helper/);
  });
});

describe("formatFailuresOnly / formatReportCompact", () => {
  const openCodeFresh = {
    platform: "opencode" as const,
    vendoredDate: "2026-05-17",
    liveSchemaId: "https://opencode.ai/config.json",
    liveVersion: "1.14.28",
    status: "fresh" as const,
    sourceUrl: "https://opencode.ai/config.json",
  };
  const openCodeDrift = {
    platform: "opencode" as const,
    vendoredDate: "2026-05-13",
    liveSchemaId: "https://opencode.ai/config.json",
    liveVersion: null,
    sourceUrl: "https://opencode.ai/config.json",
    status: "drift" as const,
    drift: {
      headline: "1 added, 2 removed, 1 changed",
      added: ["$defs/Config/properties/permission/$ref"],
      removed: [
        "$defs/Config/properties/permission/anyOf",
        "$defs/Config/properties/permission/description",
      ],
      changed: ["$defs/ImageAttachmentConfig/properties/max_base64_bytes/description"],
    },
  };
  const openCodeNetErr = {
    platform: "opencode" as const,
    status: "network-error" as const,
    vendoredDate: "2026-05-17",
    liveSchemaId: null,
    liveVersion: null,
    networkError: "ECONNREFUSED",
    sourceUrl: "https://opencode.ai/config.json",
  };
  const claudeManual = {
    platform: "claude-code" as const,
    status: "manual" as const,
    lastVerifiedDate: "2026-05-17",
    verifiedAgainstVersion: "1.0.0",
    sourceUrl: "https://docs.anthropic.com/claude/docs/claude-code",
    notes: "",
  };
  const codexManual = {
    platform: "codex" as const,
    status: "manual" as const,
    lastVerifiedDate: "2026-05-17",
    verifiedAgainstVersion: "1.0.0",
    sourceUrl: "https://github.com/openai/codex",
    notes: "",
  };

  function mkReport(platforms: DoctorReport["platforms"]): DoctorReport {
    return {
      generatedAt: "2026-05-17T00:00:00.000Z",
      platforms,
      skippedPlatforms: [],
      exitCode: 0 as const,
    };
  }

  const sumOpencodeOk: CapturedSectionSummary = {
    id: "opencode",
    label: "OpenCode schema",
    status: "ok",
    summary: "OpenCode schema fresh",
  };
  const sumClaudeOk: CapturedSectionSummary = {
    id: "claude-code",
    label: "Claude Code",
    status: "ok",
    summary: "Claude Code manual (verified)",
  };
  const sumCodexOk: CapturedSectionSummary = {
    id: "codex",
    label: "Codex",
    status: "ok",
    summary: "Codex manual (verified)",
  };
  const sumOpencodeWarn: CapturedSectionSummary = {
    id: "opencode",
    label: "OpenCode schema",
    status: "warn",
    summary: "OpenCode schema drift detected",
  };
  const sumOpencodeError: CapturedSectionSummary = {
    id: "opencode",
    label: "OpenCode schema",
    status: "error",
    summary: "OpenCode schema network error",
  };

  const FOOTER = DEFAULT_FOOTER_LINES.join("\n");

  test("formatFailuresOnly: all-green = footer only", () => {
    const report = mkReport([openCodeFresh, claudeManual, codexManual]);
    const out = formatFailuresOnly(report, [sumOpencodeOk, sumClaudeOk, sumCodexOk]);
    expect(out).toBe(FOOTER);
  });

  test("formatFailuresOnly: one warn (opencode drift) expands with detail + footer", () => {
    const report = mkReport([openCodeDrift, claudeManual, codexManual]);
    const out = formatFailuresOnly(report, [sumOpencodeWarn, sumClaudeOk, sumCodexOk]);
    expect(out.startsWith("⚠ OpenCode schema (warn):\n")).toBe(true);
    expect(out).toContain("  OpenCode:");
    expect(out).toContain("  Diff summary:     1 added, 2 removed, 1 changed");
    expect(out.endsWith(FOOTER)).toBe(true);
  });

  test("formatFailuresOnly: one error (opencode network-error) expands with detail + footer", () => {
    const report = mkReport([openCodeNetErr, claudeManual, codexManual]);
    const out = formatFailuresOnly(report, [sumOpencodeError, sumClaudeOk, sumCodexOk]);
    expect(out.startsWith("✖ OpenCode schema (error):\n")).toBe(true);
    expect(out).toContain("NETWORK ERROR");
    expect(out.endsWith(FOOTER)).toBe(true);
  });

  test("formatFailuresOnly: capture order preserved (warn first, then error)", () => {
    // Simulate two opencode entries (only one really exists; in practice
    // warn+error would come from different sections, but we just check order).
    const report = mkReport([openCodeDrift, claudeManual, codexManual]);
    // Use one warn (opencode) and one error (workspace-style fake via opencode
    // network-error is mutually exclusive with drift on the same platform, so
    // use a separate section id whose detail is not present — it should be
    // skipped and we just check the warn appears).
    // To test ordering properly, use opencode drift + a fake "registry-hygiene"
    // error: but registry-hygiene isn't in the report, so it gets skipped.
    // Easier: just verify ordering by checking the warn block appears before
    // the footer, and that if we swap to error-first the icon is ✖ first.
    const out1 = formatFailuresOnly(report, [
      sumOpencodeWarn,
      { id: "claude-code", label: "Claude Code", status: "error", summary: "x" },
      sumCodexOk,
    ]);
    // claude-code error has a manual detail body; should appear after warn
    const warnIdx = out1.indexOf("⚠ OpenCode schema (warn):");
    const errIdx = out1.indexOf("✖ Claude Code (error):");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(errIdx).toBeGreaterThan(warnIdx);
  });

  test("formatFailuresOnly: ok/skipped never expand", () => {
    const report = mkReport([openCodeFresh, claudeManual, codexManual]);
    const out = formatFailuresOnly(report, [
      sumOpencodeOk,
      {
        id: "claude-code",
        label: "Claude Code",
        status: "skipped",
        summary: "Claude Code skipped",
      },
      sumCodexOk,
    ]);
    expect(out).toBe(FOOTER);
  });

  test("formatReportCompact: all-green = 3 summary lines + blank + footer", () => {
    const report = mkReport([openCodeFresh, claudeManual, codexManual]);
    const out = formatReportCompact(report, [sumOpencodeOk, sumClaudeOk, sumCodexOk]);
    const expected = [
      "✔ OpenCode schema fresh",
      "✔ Claude Code manual (verified)",
      "✔ Codex manual (verified)",
      "",
      ...DEFAULT_FOOTER_LINES,
    ].join("\n");
    expect(out).toBe(expected);
  });

  test("formatReportCompact: one warn = summary lines (⚠ on warn) + blank + ⚠ block + blank + footer", () => {
    const report = mkReport([openCodeDrift, claudeManual, codexManual]);
    const out = formatReportCompact(report, [sumOpencodeWarn, sumClaudeOk, sumCodexOk]);
    expect(out).toContain("⚠ OpenCode schema drift detected");
    expect(out).toContain("✔ Claude Code manual (verified)");
    expect(out).toContain("⚠ OpenCode schema (warn):");
    expect(out.endsWith(FOOTER)).toBe(true);
    expect(out.split("\n").length).toBeLessThanOrEqual(25);
  });
});

describe("formatModelResolutionCompact", () => {

  function mrFull(over: Partial<import("../../../src/core/freshness/types").ModelResolutionReport> = {}): import("../../../src/core/freshness/types").ModelResolutionReport {
    return {
      opencodeCliPath: "/fake/opencode",
      liveModelCount: 2,
      curatedFallbacks: [{ tier: "high", value: "p/opus", inLiveList: false }],
      installedAgents: [
        { platform: "opencode", agent: "agent-smith", model: "p/old", inLiveList: false },
        { platform: "codex", agent: "beta", model: "gpt-5", inLiveList: null },
      ],
      hasStale: true,
      detectedProviders: ["opencode"],
      preferenceOrder: [{ provider: "opencode", source: "default" }],
      platforms: {
        opencode: { cliInstalled: true, status: "authenticated" },
        "claude-code": { cliInstalled: true, status: "authenticated" },
        codex: { cliInstalled: true, status: "unauthenticated" },
        kiro: { cliInstalled: true, status: "authenticated" },
      },
      tierPreview: [],
      ...over,
    };
  }

  test("shows only actionable lines, not the readiness/tier matrix", () => {
    const out = formatModelResolutionCompact(mrFull());
    expect(out).toContain("agent-smith");
    expect(out).toContain("smith agent install");
    expect(out).toContain("beta"); // agent on unauthenticated codex
    expect(out).not.toContain("Platform readiness:");
    expect(out).not.toContain("Tier resolution preview");
    expect(out).not.toContain("Curated high fallback");
  });

  test("no actionable items → fallback line", () => {
    const out = formatModelResolutionCompact(
      mrFull({
        installedAgents: [
          { platform: "opencode", agent: "a", model: "p/x", inLiveList: true },
        ],
        hasStale: false,
        platforms: {
          opencode: { cliInstalled: true, status: "authenticated" },
          "claude-code": { cliInstalled: true, status: "authenticated" },
          codex: { cliInstalled: true, status: "authenticated" },
          kiro: { cliInstalled: true, status: "authenticated" },
        },
      }),
    );
    expect(out).toContain("See `smith doctor --verbose` for details.");
  });
});
