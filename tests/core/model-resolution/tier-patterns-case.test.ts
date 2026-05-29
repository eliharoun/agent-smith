// PURPOSE: pin the case-insensitivity of TIER_PATTERNS regexes.
// `opencode models` output is canonically lowercase ("github-copilot/claude-opus-4.7"),
// but other providers may emit uppercase or mixed-case (e.g. "Anthropic/Claude-Opus-4.5").
// The /i flag on each regex is what makes resolveOpenCodeModel work across casings.
// If a future refactor drops the flag, this test fails loudly so the regression
// is caught before users hit it.
import { describe, expect, test } from "bun:test";
import { TIER_PATTERNS } from "../../../src/core/model-resolution/types";

describe("TIER_PATTERNS case-insensitivity (regression pin)", () => {
  test("high matches lowercase", () => {
    expect(TIER_PATTERNS.high.test("github-copilot/claude-opus-4.7")).toBe(true);
  });
  test("high matches uppercase", () => {
    expect(TIER_PATTERNS.high.test("ANTHROPIC/CLAUDE-OPUS-4-5")).toBe(true);
  });
  test("high matches mixed case", () => {
    expect(TIER_PATTERNS.high.test("Anthropic/Claude-Opus-4.5")).toBe(true);
  });
  test("balanced matches lowercase", () => {
    expect(TIER_PATTERNS.balanced.test("github-copilot/claude-sonnet-4.6")).toBe(true);
  });
  test("balanced matches uppercase", () => {
    expect(TIER_PATTERNS.balanced.test("PROVIDER/CLAUDE-SONNET-4")).toBe(true);
  });
  test("fast matches lowercase", () => {
    expect(TIER_PATTERNS.fast.test("github-copilot/claude-haiku-4.5")).toBe(true);
  });
  test("fast matches uppercase", () => {
    expect(TIER_PATTERNS.fast.test("PROVIDER/CLAUDE-HAIKU-4")).toBe(true);
  });
  test("each pattern has the /i flag set", () => {
    expect(TIER_PATTERNS.high.flags).toContain("i");
    expect(TIER_PATTERNS.balanced.flags).toContain("i");
    expect(TIER_PATTERNS.fast.flags).toContain("i");
  });
});
