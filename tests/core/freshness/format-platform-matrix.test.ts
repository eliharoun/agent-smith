import { describe, expect, test } from "bun:test";
import { formatModelResolutionSection } from "../../../src/core/freshness/format";
import type { DoctorReport } from "../../../src/core/freshness/types";

const baseReport: NonNullable<DoctorReport["modelResolution"]> = {
  opencodeCliPath: "/usr/local/bin/opencode",
  liveModelCount: 0,
  curatedFallbacks: [
    { tier: "high", value: "github-copilot/claude-opus-4.7", inLiveList: false },
    { tier: "balanced", value: "github-copilot/claude-sonnet-4.6", inLiveList: false },
    { tier: "fast", value: "github-copilot/claude-haiku-4.5", inLiveList: false },
  ],
  installedAgents: [],
  hasStale: false,
  detectedProviders: [],
  preferenceOrder: [],
  platforms: {
    opencode: { cliInstalled: true, status: "unauthenticated", detail: "no providers configured" },
    "claude-code": {
      cliInstalled: true,
      status: "authenticated",
      detail: "available models: opus, sonnet",
      availableModels: ["opus", "sonnet"],
    },
    codex: { cliInstalled: false, status: "cli-not-installed" },
    kiro: { cliInstalled: true, status: "authenticated", detail: "logged in (IdC)" },
  },
  tierPreview: [
    {
      tier: "high",
      resolved: null,
      perPlatform: {
        opencode: null,
        "claude-code": "opus",
        codex: null,
        kiro: "claude-opus-4.6",
      },
      source: "failed",
      message: "set SMITH_TIER_HIGH or run `opencode auth login`",
    },
    {
      tier: "balanced",
      resolved: null,
      perPlatform: {
        opencode: null,
        "claude-code": "sonnet",
        codex: null,
        kiro: "claude-sonnet-4.6",
      },
      source: "failed",
      message: "set SMITH_TIER_BALANCED or run `opencode auth login`",
    },
    {
      tier: "fast",
      resolved: null,
      perPlatform: {
        opencode: null,
        "claude-code": null,
        codex: null,
        kiro: "claude-haiku-4.5",
      },
      source: "failed",
      message: "set SMITH_TIER_FAST or run `opencode auth login`",
    },
  ],
};

describe("formatModelResolutionSection: per-platform matrix", () => {
  test("renders a Platform readiness section listing all four platforms", () => {
    const out = formatModelResolutionSection(baseReport);
    expect(out).toContain("Platform readiness");
    expect(out).toContain("OpenCode");
    expect(out).toContain("Claude Code");
    expect(out).toContain("Codex");
    expect(out).toContain("Kiro");
  });

  test("readiness shows status per platform with hint when unauthenticated", () => {
    const out = formatModelResolutionSection(baseReport);
    expect(out).toMatch(/OpenCode\s+.*unauthenticated/i);
    expect(out).toMatch(/Claude Code\s+.*authenticated/i);
    expect(out).toMatch(/Codex\s+.*not installed/i);
    expect(out).toMatch(/Kiro\s+.*authenticated/i);
  });

  test("tier preview shows per-platform resolution columns, not a single line", () => {
    const out = formatModelResolutionSection(baseReport);
    // Each tier line should reference at least the platforms that resolved.
    expect(out).toMatch(/high.*opus/i);
    expect(out).toMatch(/balanced.*sonnet/i);
    // Failures are visible.
    expect(out).toMatch(/UNRESOLVABLE|—|·|null/);
  });

  test("emits the legacy detail (curated fallback drift) for backward compat", () => {
    const out = formatModelResolutionSection(baseReport);
    expect(out).toContain("Curated high fallback");
  });
});
