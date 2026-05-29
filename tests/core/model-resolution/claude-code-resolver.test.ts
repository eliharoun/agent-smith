// tests/core/model-resolution/claude-code-resolver.test.ts
import { describe, expect, test } from "bun:test";
import { resolveClaudeCodeModel } from "../../../src/core/model-resolution/claude-code";
import { makeWarningCollector } from "../../../src/core/model-resolution/types";
import type { CanonicalConfig } from "../../../src/core/types";

function baseConfig(over: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "x",
    description: "Use proactively for tests",
    targets: ["claude-code"],
    modelTier: "high",
    ...over,
  };
}

describe("resolveClaudeCodeModel", () => {
  const authedDetect = async () => ({
    platform: "claude-code" as const,
    cliInstalled: true,
    status: "authenticated" as const,
    availableModels: ["opus", "sonnet", "haiku"],
  });
  const env = {
    getOpenCodeModels: async () => undefined,
    warnings: makeWarningCollector(),
    detectClaudeCodeAuth: authedDetect,
  };

  test("tier high returns 'opus' literal for Claude Code", async () => {
    expect(await resolveClaudeCodeModel(baseConfig({ modelTier: "high" }), env)).toBe("opus");
  });

  test("tier inherit returns undefined (no model line)", async () => {
    expect(await resolveClaudeCodeModel(baseConfig({ modelTier: "inherit" }), env)).toBeUndefined();
  });

  test("model override is honored (parity with opencode/codex/kiro resolvers)", async () => {
    // Update from prior behavior: previously the claude-code resolver was the
    // odd one out and ignored canonical.model. Per the per-platform-auth
    // refactor, claude-code now honors `canonical.model` like every sibling
    // resolver — the validator still emits an info-note when both
    // `model` and `modelTier` are set.
    const r = await resolveClaudeCodeModel(
      baseConfig({ modelTier: "balanced", model: "claude-3-7-opus-2026" }),
      env,
    );
    expect(r).toBe("claude-3-7-opus-2026");
  });
});
