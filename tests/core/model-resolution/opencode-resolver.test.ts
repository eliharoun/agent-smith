// tests/core/model-resolution/opencode-resolver.test.ts
import { describe, expect, test } from "bun:test";
import { resolveOpenCodeModel } from "../../../src/core/model-resolution/opencode";
import {
  PlatformUnavailableError,
  type ModelResolutionEnv,
  makeWarningCollector,
} from "../../../src/core/model-resolution/types";
import { SmithError } from "../../../src/core/smith-error";
import type { CanonicalConfig } from "../../../src/core/types";

function baseConfig(over: Partial<CanonicalConfig> = {}): CanonicalConfig {
  return {
    schemaVersion: 1,
    name: "x",
    description: "Use proactively",
    targets: ["opencode"],
    modelTier: "high",
    ...over,
  };
}

function envWith(
  getOpenCodeModels: () => Promise<string[] | undefined>,
  authenticated?: string[],
): ModelResolutionEnv & { collected: ReturnType<typeof makeWarningCollector> } {
  const collector = makeWarningCollector();
  return {
    getOpenCodeModels,
    warnings: collector,
    detectAuthenticatedProviders: async () => {
      if (authenticated) return authenticated;
      // Infer from live list for backward compat with old tests
      const live = await getOpenCodeModels();
      if (!live) return [];
      const set = new Set<string>();
      for (const id of live) {
        const idx = id.indexOf("/");
        if (idx > 0) set.add(id.slice(0, idx));
      }
      return [...set];
    },
    // Stub the auth detector to "CLI installed, status authenticated"
    // so existing tests continue to behave exactly as before. Tests that
    // need the cli-not-installed branch construct their own ModelResolutionEnv
    // with an explicit detector — see the "CLI not installed" describe block
    // below. This keeps the production default
    // (detectOpenCodeAuth = defaultDetectOpenCodeAuth) out of every test.
    detectOpenCodeAuth: async () => ({
      platform: "opencode" as const,
      cliInstalled: true,
      status: "authenticated" as const,
    }),
    env: {},
    collected: collector,
  };
}

describe("resolveOpenCodeModel", () => {
  test("explicit model override returned verbatim, ignores tier and live list", async () => {
    const env = envWith(async () => ["github-copilot/claude-opus-4.7"]);
    const r = await resolveOpenCodeModel(
      baseConfig({ modelTier: "fast", model: "anthropic/whatever-1.0" }),
      env,
    );
    expect(r).toBe("anthropic/whatever-1.0");
    expect(env.collected.warnings).toEqual([]);
  });

  test("tier inherit returns undefined, no warning, no live query", async () => {
    let called = false;
    const env = envWith(async () => {
      called = true;
      return [];
    });
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "inherit" }), env);
    expect(r).toBeUndefined();
    expect(called).toBe(false);
    expect(env.collected.warnings).toEqual([]);
  });

  test("live list with multiple opus variants returns highest version", async () => {
    const env = envWith(async () => [
      "github-copilot/claude-opus-4.6",
      "github-copilot/claude-opus-4.7",
      "github-copilot/claude-sonnet-4.6",
    ]);
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "high" }), env);
    expect(r).toBe("github-copilot/claude-opus-4.7");
    expect(env.collected.warnings).toEqual([]);
  });

  test("live list with zero matches for tier throws SmithError (fail-loud)", async () => {
    // Models from unknown providers that don't match any table entry
    const env = envWith(async () => ["unknown-provider/some-model", "another/thing"]);
    await expect(resolveOpenCodeModel(baseConfig({ modelTier: "high" }), env)).rejects.toThrow(
      SmithError,
    );
  });

  test("getOpenCodeModels returns undefined with authenticated provider -> curated fallback + warning", async () => {
    const env = envWith(async () => undefined, ["github-copilot"]);
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "balanced" }), env);
    expect(r).toBe("github-copilot/claude-sonnet-4.6");
    expect(env.collected.warnings[0]?.message).toMatch(/unavailable/i);
  });

  test("getOpenCodeModels returns empty array with authenticated provider -> throws (curated not in live)", async () => {
    // Empty live list: step 7 finds nothing, step 8 checks live.includes(curated)
    // which is false for empty array, falls through to fail-loud Step 9.
    const env = envWith(async () => [], ["github-copilot"]);
    await expect(resolveOpenCodeModel(baseConfig({ modelTier: "fast" }), env)).rejects.toThrow(
      SmithError,
    );
  });

  test("model override is returned even if malformed/nonexistent (no validation)", async () => {
    const env = envWith(async () => ["github-copilot/claude-opus-4.7"]);
    const r = await resolveOpenCodeModel(baseConfig({ model: "garbage-not-a-real-id" }), env);
    expect(r).toBe("garbage-not-a-real-id");
    expect(env.collected.warnings).toEqual([]);
  });

  test("tier balanced picks 4.6 over 4 when both present", async () => {
    const env = envWith(async () => [
      "github-copilot/claude-sonnet-4",
      "github-copilot/claude-sonnet-4.6",
    ]);
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "balanced" }), env);
    expect(r).toBe("github-copilot/claude-sonnet-4.6");
  });

  test("tier fast picks thinking-fast variant over bare", async () => {
    const env = envWith(async () => [
      "github-copilot/claude-haiku-4.5",
      "github-copilot/claude-haiku-4.5-thinking-fast",
    ]);
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "fast" }), env);
    expect(r).toBe("github-copilot/claude-haiku-4.5-thinking-fast");
  });

  test("multiple provider prefixes — higher-precedence provider wins", async () => {
    const env = envWith(async () => [
      "anthropic/claude-opus-4-5",
      "github-copilot/claude-opus-4.7",
    ]);
    // github-copilot has higher precedence than anthropic
    const r = await resolveOpenCodeModel(baseConfig({ modelTier: "high" }), env);
    expect(r).toBe("github-copilot/claude-opus-4.7");
  });

  test("warning message includes tier name AND chosen fallback string", async () => {
    const env = envWith(async () => undefined, ["github-copilot"]);
    await resolveOpenCodeModel(baseConfig({ modelTier: "high" }), env);
    const msg = env.collected.warnings[0]?.message ?? "";
    expect(msg).toMatch(/high/);
    expect(msg).toContain("github-copilot/claude-opus-4.7");
  });

  test("warning target field is 'opencode'", async () => {
    const env = envWith(async () => undefined, ["github-copilot"]);
    await resolveOpenCodeModel(baseConfig(), env);
    expect(env.collected.warnings[0]?.target).toBe("opencode");
  });

  test("fail-loud: only openai authenticated, no live tier match, throws SmithError", async () => {
    // This is the exact scenario Q3=c was designed to prevent:
    // User has only openai authenticated, live list has only openai/gpt-3 (no opus pattern),
    // tier=high. Pre-fix: silently returned github-copilot/claude-opus-4.7. Post-fix: throws.
    const env = envWith(async () => ["openai/gpt-3"], ["openai"]);
    try {
      await resolveOpenCodeModel(baseConfig({ modelTier: "high", name: "my-agent" }), env);
      expect.unreachable("should have thrown SmithError");
    } catch (e) {
      expect(e).toBeInstanceOf(SmithError);
      const se = e as SmithError;
      expect(se.payload.code).toBe("model-resolution-failed");
      if (se.payload.code === "model-resolution-failed") {
        expect(se.payload.tier).toBe("high");
        expect(se.payload.preferences).toContain("openai");
      }
    }
  });

  // ─── CLI-not-installed (parity with kiro/claude/codex resolvers) ──
  // These tests mirror the contract the other three resolvers already
  // implement: when the platform CLI isn't on PATH, throw
  // PlatformUnavailableError so the orchestrator silently drops the
  // target — the user simply doesn't have OpenCode and we shouldn't
  // tell them to "run opencode auth login".

  test("CLI not installed -> throws PlatformUnavailableError (no auth-login advice)", async () => {
    const collector = makeWarningCollector();
    const env: ModelResolutionEnv = {
      // Non-undefined live list to prove the resolver doesn't fall
      // through to the curated-fallback path; the auth detector's
      // verdict must take precedence.
      getOpenCodeModels: async () => undefined,
      detectAuthenticatedProviders: async () => [],
      detectOpenCodeAuth: async () => ({
        platform: "opencode",
        cliInstalled: false,
        status: "cli-not-installed",
      }),
      warnings: collector,
      env: {},
    };
    await expect(
      resolveOpenCodeModel(baseConfig({ modelTier: "high" }), env),
    ).rejects.toBeInstanceOf(PlatformUnavailableError);
    // No "auth login" warning should have been emitted — the user
    // doesn't have OpenCode, telling them to authenticate would be wrong.
    for (const w of collector.warnings) {
      expect(w.message.toLowerCase()).not.toContain("auth login");
    }
  });

  test("CLI not installed + allowMissingCli -> returns curated tier literal + warning", async () => {
    const collector = makeWarningCollector();
    const env: ModelResolutionEnv = {
      getOpenCodeModels: async () => undefined,
      detectAuthenticatedProviders: async () => [],
      detectOpenCodeAuth: async () => ({
        platform: "opencode",
        cliInstalled: false,
        status: "cli-not-installed",
      }),
      warnings: collector,
      env: {},
      allowMissingCli: true,
    };
    const result = await resolveOpenCodeModel(
      baseConfig({ modelTier: "high" }),
      env,
    );
    // Mirrors kiro/claude/codex: returns a tier-mapped curated literal
    // when --allow-missing-cli is set (used by hermetic CI flows).
    expect(typeof result).toBe("string");
    expect(result).toMatch(/opus|claude/i);
    // Warning must mention "not installed", not "auth login".
    expect(collector.warnings.length).toBeGreaterThan(0);
    expect(collector.warnings[0]?.message).toMatch(/not installed/i);
    expect(collector.warnings[0]?.message.toLowerCase()).not.toContain(
      "auth login",
    );
  });

  test("CLI installed but unauthenticated -> existing curated-fallback path still works", async () => {
    // This regression-pins the case where the CLI IS installed but
    // no providers are authenticated. The existing behavior (curated
    // fallback when getOpenCodeModels returns undefined and
    // authenticated providers is non-empty) must continue to work.
    const collector = makeWarningCollector();
    const env: ModelResolutionEnv = {
      getOpenCodeModels: async () => undefined,
      detectAuthenticatedProviders: async () => ["github-copilot"],
      detectOpenCodeAuth: async () => ({
        platform: "opencode",
        cliInstalled: true,
        status: "authenticated",
      }),
      warnings: collector,
      env: {},
    };
    const result = await resolveOpenCodeModel(
      baseConfig({ modelTier: "balanced" }),
      env,
    );
    expect(result).toBe("github-copilot/claude-sonnet-4.6");
  });
});
