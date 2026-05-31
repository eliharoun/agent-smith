import { describe, expect, test } from "bun:test";
import { resolveKiroModel } from "../../../src/core/model-resolution/kiro";
import { makeWarningCollector } from "../../../src/core/model-resolution/types";
import type { CanonicalConfig } from "../../../src/core/types";
import type { ModelResolutionEnv } from "../../../src/core/model-resolution/types";

const authedDetect = async () => ({
  platform: "kiro" as const,
  cliInstalled: true,
  status: "authenticated" as const,
  detail: "logged in (IdC)",
});

// Existing static-mapping tests run with an authenticated stub so the
// resolver doesn't probe the real filesystem.
const env: ModelResolutionEnv = {
  getOpenCodeModels: async () => undefined,
  warnings: { push() {} },
  detectAuthenticatedProviders: async () => [],
  detectKiroAuth: authedDetect,
  env: {},
};

function fixture(overrides: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "x",
    description: "x",
    targets: ["kiro"],
    modelTier: "balanced",
    ...overrides,
  };
}

describe("resolveKiroModel", () => {
  test("inherit → undefined (kiro defaults to its 'auto' selector)", async () => {
    expect(await resolveKiroModel(fixture({ modelTier: "inherit" }), env)).toBeUndefined();
  });

  test("high → claude-opus-4.6", async () => {
    expect(await resolveKiroModel(fixture({ modelTier: "high" }), env)).toBe("claude-opus-4.6");
  });

  test("balanced → claude-sonnet-4.6", async () => {
    expect(await resolveKiroModel(fixture({ modelTier: "balanced" }), env)).toBe(
      "claude-sonnet-4.6",
    );
  });

  test("fast → claude-haiku-4.5", async () => {
    expect(await resolveKiroModel(fixture({ modelTier: "fast" }), env)).toBe("claude-haiku-4.5");
  });

  test("explicit model field overrides tier when kiro is in targets", async () => {
    const out = await resolveKiroModel(
      fixture({ modelTier: "balanced", model: "claude-opus-4.7" }),
      env,
    );
    expect(out).toBe("claude-opus-4.7");
  });

  test("explicit model is ignored when kiro is NOT in targets", async () => {
    // Defensive: even though resolveKiroModel shouldn't normally be called
    // for a non-kiro bundle, this documents the override gate clearly.
    const out = await resolveKiroModel(
      fixture({ modelTier: "balanced", model: "x", targets: ["opencode"] }),
      env,
    );
    expect(out).toBe("claude-sonnet-4.6"); // tier wins
  });

  test("uses SMITH_KIRO_TIER_<TIER> env override", async () => {
    const result = await resolveKiroModel(fixture({ modelTier: "high" }), {
      ...env,
      env: { SMITH_KIRO_TIER_HIGH: "claude-opus-5.0" },
    });
    expect(result).toBe("claude-opus-5.0");
  });

  test("throws PlatformUnavailableError when CLI is not installed (no warning)", async () => {
    const warnings = makeWarningCollector();
    const { PlatformUnavailableError } = await import(
      "../../../src/core/model-resolution/types"
    );
    let caught: unknown;
    try {
      await resolveKiroModel(fixture({ modelTier: "high" }), {
        ...env,
        warnings,
        detectKiroAuth: async () => ({
          platform: "kiro",
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

  test("renders the tier literal + warning when CLI missing and allowMissingCli set", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveKiroModel(fixture({ modelTier: "high", targets: ["kiro"] }), {
      getOpenCodeModels: async () => undefined,
      warnings,
      allowMissingCli: true,
      detectKiroAuth: async () => ({ platform: "kiro", cliInstalled: false, status: "cli-not-installed" }),
    });
    expect(result).toBe("claude-opus-4.6");
    expect(warnings.warnings.length).toBe(1);
    expect(warnings.warnings[0]?.message).toMatch(/not installed/i);
  });

  test("returns undefined and warns when unauthenticated", async () => {
    const warnings = makeWarningCollector();
    const result = await resolveKiroModel(fixture({ modelTier: "high" }), {
      ...env,
      warnings,
      detectKiroAuth: async () => ({
        platform: "kiro",
        cliInstalled: true,
        status: "unauthenticated",
      }),
    });
    expect(result).toBeUndefined();
    expect(warnings.warnings[0]?.message).toMatch(/kiro-cli login/);
  });
});
