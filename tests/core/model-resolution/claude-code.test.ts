import { describe, expect, it } from "bun:test";
import { resolveClaudeCodeModel } from "../../../src/core/model-resolution/claude-code";
import { makeWarningCollector } from "../../../src/core/model-resolution/types";
import type { CanonicalConfig } from "../../../src/core/types";

const cfg = (overrides: Partial<CanonicalConfig> = {}): CanonicalConfig =>
  ({
    name: "test-agent",
    description: "Test agent for unit tests",
    targets: ["claude-code"],
    modelTier: "high",
    mode: "subagent",
    permissions: { read: "allow" },
    ...overrides,
  }) as CanonicalConfig;

describe("resolveClaudeCodeModel", () => {
  it("returns undefined for modelTier:'inherit'", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "inherit" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus", "sonnet"],
      }),
    });
    expect(result).toBeUndefined();
  });

  it("maps high tier to 'opus' when settings has opus available", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus", "sonnet"],
      }),
    });
    expect(result).toBe("opus");
    expect(warnings.warnings).toHaveLength(0);
  });

  it("substitutes 'sonnet' for 'fast' tier when haiku is not in availableModels", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "fast" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus", "sonnet"],
      }),
    });
    expect(result).toBe("sonnet");
    // Should warn about substitution
    expect(warnings.warnings.length).toBeGreaterThan(0);
    expect(warnings.warnings[0]?.message).toMatch(/fast.*haiku.*sonnet|substituted/i);
  });

  it("substitutes 'opus' for any tier when only opus is available", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "balanced" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus"],
      }),
    });
    expect(result).toBe("opus");
    expect(warnings.warnings.length).toBeGreaterThan(0);
  });

  it("uses SMITH_CLAUDE_TIER_<TIER> env override when set", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      env: { SMITH_CLAUDE_TIER_HIGH: "claude-3-5-haiku-20241022" },
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus", "sonnet"],
      }),
    });
    expect(result).toBe("claude-3-5-haiku-20241022");
  });

  it("falls back to legacy hardcoded mapping when settings.json has no availableModels", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "balanced" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        // No availableModels — Claude Code resolves natively at runtime
      }),
    });
    expect(result).toBe("sonnet");
    expect(warnings.warnings).toHaveLength(0);
  });

  it("throws PlatformUnavailableError when CLI is not installed (no warning)", async () => {
    const warnings = makeWarningCollector();
    const { PlatformUnavailableError } = await import(
      "../../../src/core/model-resolution/types"
    );
    let caught: unknown;
    try {
      await resolveClaudeCodeModel(cfg({ modelTier: "high" }), {
        getOpenCodeModels: async () => undefined,
        warnings,
        detectClaudeCodeAuth: async () => ({
          platform: "claude-code",
          cliInstalled: false,
          status: "cli-not-installed",
        }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlatformUnavailableError);
    // No warning is emitted — the orchestrator handles this as a silent skip.
    expect(warnings.warnings).toEqual([]);
  });

  it("returns undefined and warns when unauthenticated", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "unauthenticated",
      }),
    });
    expect(result).toBeUndefined();
    expect(warnings.warnings.length).toBeGreaterThan(0);
    expect(warnings.warnings[0]?.message).toMatch(/unauthenticated|claude auth login/i);
  });

  it("renders the tier literal + warning when CLI missing and allowMissingCli set", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      allowMissingCli: true,
      detectClaudeCodeAuth: async () => ({ platform: "claude-code", cliInstalled: false, status: "cli-not-installed" }),
    });
    expect(result).toBe("opus");
    expect(warnings.warnings.length).toBe(1);
    expect(warnings.warnings[0]?.message).toMatch(/not installed/i);
  });

  it("uses opencode-style canonical.model override before tier resolution", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveClaudeCodeModel(
      cfg({ modelTier: "high", model: "claude-3-7-sonnet-20250219" }),
      {
        getOpenCodeModels: async () => undefined,
        warnings,
        detectClaudeCodeAuth: async () => ({
          platform: "claude-code",
          cliInstalled: true,
          status: "authenticated",
          availableModels: ["opus", "sonnet"],
        }),
      },
    );
    expect(result).toBe("claude-3-7-sonnet-20250219");
  });
});
