/**
 * Tests for the install-output formatter that groups CLI output by
 * agent + platform with status glyphs and a next-steps footer.
 *
 * Why a dedicated formatter (extracted from install.ts):
 *   1. The display logic is now non-trivial enough that pure-function
 *      tests are easier to write than CLI integration tests.
 *   2. The same formatter feeds the GUI's install panel.
 *   3. Adding new statuses (e.g. "ask"/"skill-failed") later doesn't
 *      require touching install.ts.
 */
import { describe, expect, it } from "bun:test";
import { formatInstallSummary } from "../../src/cli/format-install";

describe("formatInstallSummary", () => {
  it("renders nothing when there's nothing to install or skip", () => {
    const out = formatInstallSummary({
      installed: [],
      skipped: [],
      warnings: [],
    });
    expect(out).toEqual([]);
  });

  it("groups installed/skipped/skipped-target by agent name", () => {
    const out = formatInstallSummary({
      installed: [
        { target: "claude-code", path: "/c/agent-smith.md", agent: "agent-smith" },
        { target: "opencode", path: "/o/agent-smith.md", agent: "agent-smith" },
      ],
      skipped: [],
      warnings: [],
    });
    // Single agent → single header section. Both targets listed under it,
    // each with its install path so the user sees where files landed.
    const headers = out.filter((line) => line.startsWith("[agent-smith]"));
    expect(headers.length).toBe(1);
    expect(out.some((l) => /claude-code.*\/c\/agent-smith\.md/.test(l))).toBe(true);
    expect(out.some((l) => /opencode.*\/o\/agent-smith\.md/.test(l))).toBe(true);
  });

  it("renders skipped (unchanged) with a different glyph than installed", () => {
    const out = formatInstallSummary({
      installed: [
        { target: "claude-code", path: "/c/x.md", agent: "x" },
      ],
      skipped: [
        { target: "opencode", path: "/o/x.md", agent: "x" },
      ],
      warnings: [],
    });
    // Look for a clear distinction (e.g. "✓" for installed, "·" for unchanged)
    const installedLine = out.find((l) => l.includes("claude-code"));
    const unchangedLine = out.find((l) => l.includes("opencode"));
    expect(installedLine).toBeDefined();
    expect(unchangedLine).toBeDefined();
    expect(unchangedLine).toMatch(/unchanged|up to date/i);
  });

  it("renders 'X up to date' summary when nothing was newly installed", () => {
    const out = formatInstallSummary({
      installed: [],
      skipped: [
        { target: "claude-code", path: "/c/x.md", agent: "x" },
        { target: "opencode", path: "/o/x.md", agent: "x" },
      ],
      warnings: [],
    });
    // The summary line should not say "0 installed" — that reads as failure.
    const summaryCandidates = out.filter((l) => /up to date|installed/i.test(l));
    expect(summaryCandidates.some((l) => /0 installed/.test(l))).toBe(false);
    expect(summaryCandidates.some((l) => /up to date/i.test(l))).toBe(true);
  });

  it("renders a next-steps footer when warnings reference an unauthenticated platform", () => {
    const out = formatInstallSummary({
      installed: [
        { target: "claude-code", path: "/c/x.md", agent: "x" },
      ],
      skipped: [],
      warnings: [
        "[x/opencode] target skipped: no model resolvable for tier 'high'. Run `opencode auth login <provider>` or set SMITH_TIER_HIGH.",
      ],
    });
    // Footer references opencode and the actionable command.
    const footer = out.join("\n");
    expect(footer).toMatch(/Next steps|To enable/i);
    expect(footer).toMatch(/opencode auth login/);
  });

  it("does NOT emit a next-steps footer when nothing is missing", () => {
    const out = formatInstallSummary({
      installed: [
        { target: "claude-code", path: "/c/x.md", agent: "x" },
        { target: "opencode", path: "/o/x.md", agent: "x" },
      ],
      skipped: [],
      warnings: [],
    });
    const footer = out.join("\n");
    expect(footer).not.toMatch(/Next steps/);
  });

  it("hides info-level warnings unless verbose is true", () => {
    const out = formatInstallSummary(
      {
        installed: [{ target: "claude-code", path: "/c/x.md", agent: "x" }],
        skipped: [],
        warnings: [
          "[x/claude-code] Pattern-based permissions for group 'skill' are not supported on this platform; using broadest action 'allow'",
        ],
      },
      { verbose: false },
    );
    const text = out.join("\n");
    expect(text).not.toContain("Pattern-based");

    const verbose = formatInstallSummary(
      {
        installed: [{ target: "claude-code", path: "/c/x.md", agent: "x" }],
        skipped: [],
        warnings: [
          "[x/claude-code] Pattern-based permissions for group 'skill' are not supported on this platform; using broadest action 'allow'",
        ],
      },
      { verbose: true },
    );
    expect(verbose.join("\n")).toContain("Pattern-based");
  });
});
