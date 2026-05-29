import { describe, expect, it } from "bun:test";
import {
  PROVIDER_TABLE_V1_0_0_RC_5,
  OPENCODE_PROVIDER_PRECEDENCE,
  sortByOpenCodePrecedence,
  getProviderTable,
} from "../../../src/core/model-resolution/provider-table";

describe("PROVIDER_TABLE_V1_0_0_RC_5", () => {
  it("covers high, balanced, fast tiers", () => {
    expect(Object.keys(PROVIDER_TABLE_V1_0_0_RC_5)).toEqual(["high", "balanced", "fast"]);
  });
  it("each tier has all 6 providers", () => {
    for (const tier of ["high", "balanced", "fast"] as const) {
      const providers = Object.keys(PROVIDER_TABLE_V1_0_0_RC_5[tier]);
      expect(providers.sort()).toEqual([
        "amazon-bedrock",
        "anthropic",
        "github-copilot",
        "google-vertex-ai",
        "openai",
        "openrouter",
      ]);
    }
  });
  it("each entry has a regex pattern and curated literal containing the provider prefix", () => {
    for (const tier of ["high", "balanced", "fast"] as const) {
      for (const [provider, entry] of Object.entries(PROVIDER_TABLE_V1_0_0_RC_5[tier])) {
        expect(entry?.pattern).toBeInstanceOf(RegExp);
        expect(entry?.curated.startsWith(`${provider}/`)).toBe(true);
      }
    }
  });
  it("patterns match expected models for each tier", () => {
    expect(PROVIDER_TABLE_V1_0_0_RC_5.high.anthropic?.pattern.test("claude-opus-4-7")).toBe(true);
    expect(PROVIDER_TABLE_V1_0_0_RC_5.balanced.openai?.pattern.test("gpt-5-mini")).toBe(true);
    expect(
      PROVIDER_TABLE_V1_0_0_RC_5.fast["github-copilot"]?.pattern.test("claude-haiku-4.5"),
    ).toBe(true);
  });
});

describe("sortByOpenCodePrecedence", () => {
  it("sorts known providers by OpenCode precedence", () => {
    const detected = ["openai", "anthropic", "github-copilot"];
    expect(sortByOpenCodePrecedence(detected)).toEqual(["github-copilot", "anthropic", "openai"]);
  });
  it("appends unknown providers at the end", () => {
    const detected = ["some-future-provider", "anthropic", "another-mystery"];
    const result = sortByOpenCodePrecedence(detected);
    expect(result[0]).toBe("anthropic");
    expect(result.slice(1).sort()).toEqual(["another-mystery", "some-future-provider"]);
  });
  it("empty input returns empty", () => {
    expect(sortByOpenCodePrecedence([])).toEqual([]);
  });
});
