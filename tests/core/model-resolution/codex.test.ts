import { describe, expect, it } from "bun:test";
import { resolveCodexModel } from "../../../src/core/model-resolution/codex";
import { makeWarningCollector } from "../../../src/core/model-resolution/types";
import type { CanonicalConfig } from "../../../src/core/types";

const cfg = (overrides: Partial<CanonicalConfig> = {}): CanonicalConfig =>
  ({
    name: "test-agent",
    description: "Test agent for unit tests",
    targets: ["codex"],
    modelTier: "high",
    mode: "subagent",
    permissions: { read: "allow" },
    ...overrides,
  }) as CanonicalConfig;

const authedAuth = async () => ({
  platform: "codex" as const,
  cliInstalled: true,
  status: "authenticated" as const,
  detail: "OPENAI_API_KEY in env",
});

describe("resolveCodexModel", () => {
  it("returns undefined for modelTier:'inherit'", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveCodexModel(cfg({ modelTier: "inherit" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectCodexAuth: authedAuth,
    });
    expect(result).toBeUndefined();
  });

  it("maps tiers to known Codex literals when authenticated", async () => {
    const warnings = makeWarningCollector();
    const high = await resolveCodexModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectCodexAuth: authedAuth,
    });
    const balanced = await resolveCodexModel(cfg({ modelTier: "balanced" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectCodexAuth: authedAuth,
    });
    const fast = await resolveCodexModel(cfg({ modelTier: "fast" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectCodexAuth: authedAuth,
    });
    expect(high).toBeDefined();
    expect(balanced).toBeDefined();
    expect(fast).toBeDefined();
    expect(high).not.toBe(balanced);
  });

  it("uses canonical.model override when bundle targets codex", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveCodexModel(
      cfg({ modelTier: "high", model: "gpt-5-codex" }),
      {
        getOpenCodeModels: async () => undefined,
        warnings,
        detectCodexAuth: authedAuth,
      },
    );
    expect(result).toBe("gpt-5-codex");
  });

  it("uses SMITH_CODEX_TIER_<TIER> env override", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveCodexModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      env: { SMITH_CODEX_TIER_HIGH: "gpt-5-pro" },
      detectCodexAuth: authedAuth,
    });
    expect(result).toBe("gpt-5-pro");
  });

  it("throws PlatformUnavailableError when CLI is not installed (no warning)", async () => {
    const warnings = makeWarningCollector();
    const { PlatformUnavailableError } = await import(
      "../../../src/core/model-resolution/types"
    );
    let caught: unknown;
    try {
      await resolveCodexModel(cfg({ modelTier: "high" }), {
        getOpenCodeModels: async () => undefined,
        warnings,
        detectCodexAuth: async () => ({
          platform: "codex",
          cliInstalled: false,
          status: "cli-not-installed",
        }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PlatformUnavailableError);
    expect(warnings.warnings).toEqual([]);
  });

  it("renders the tier literal + warning when CLI missing and allowMissingCli set", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveCodexModel(cfg({ modelTier: "high", targets: ["codex"] }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      allowMissingCli: true,
      detectCodexAuth: async () => ({ platform: "codex", cliInstalled: false, status: "cli-not-installed" }),
    });
    expect(result).toBe("gpt-5-codex");
    expect(warnings.warnings.length).toBe(1);
    expect(warnings.warnings[0]?.message).toMatch(/not installed/i);
  });

  it("returns undefined and warns when unauthenticated", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveCodexModel(cfg({ modelTier: "high" }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      detectCodexAuth: async () => ({
        platform: "codex",
        cliInstalled: true,
        status: "unauthenticated",
      }),
    });
    expect(result).toBeUndefined();
    expect(warnings.warnings[0]?.message).toMatch(/codex login|OPENAI_API_KEY/);
  });
});
