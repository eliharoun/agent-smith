import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelConfig, writeModelConfig } from "./model-config";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "model-cfg-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readModelConfig", () => {
  it("returns defaults when auth.json missing and .env empty", async () => {
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: join(dir, "auth.json"),
      getOpenCodeModels: async () => undefined,
      env: {},
    });
    expect(out.detectedProviders).toEqual([]);
    expect(out.preferenceOrder.length).toBeGreaterThan(0);
    expect(out.preferenceOrder[0].source).toBe("default");
    expect(out.tierOverrides).toEqual({ high: null, balanced: null, fast: null });
    expect(out.tierPreview.length).toBe(3);
  });

  it("detects providers from auth.json", async () => {
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ anthropic: {}, "github-copilot": {} }));
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: authPath,
      getOpenCodeModels: async () => undefined,
      env: {},
    });
    expect(out.detectedProviders).toContain("anthropic");
    expect(out.detectedProviders).toContain("github-copilot");
  });

  it("falls back to inferring providers from `opencode models` when auth.json is missing", async () => {
    // Mirror of the CLI's detectAuthenticatedProviders fallback — if
    // auth.json is absent, parse provider prefixes out of the live model
    // list. Without this, a user authenticated via `opencode auth` (which
    // doesn't always write auth.json — third-party adapters like
    // amazon-bedrock are configured via shell env or AWS credential
    // chain) sees "// none detected" in the GUI even though `opencode
    // models` returns dozens of usable models.
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: join(dir, "auth.json"), // does not exist
      getOpenCodeModels: async () => [
        "amazon-bedrock/anthropic.claude-opus-4-7",
        "amazon-bedrock/anthropic.claude-sonnet-4-6",
        "opencode/big-pickle",
      ],
      env: {},
    });
    expect(out.detectedProviders.sort()).toEqual(["amazon-bedrock", "opencode"]);
  });

  it("populates per-platform auth matrix with all four platforms", async () => {
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: join(dir, "auth.json"),
      getOpenCodeModels: async () => undefined,
      env: {},
      // Inject a stub matrix; in production the route plumbs the live
      // detectAllPlatforms() result.
      detectAllPlatforms: async () => ({
        opencode: {
          platform: "opencode",
          cliInstalled: true,
          status: "authenticated",
          detail: "providers: amazon-bedrock",
        },
        "claude-code": {
          platform: "claude-code",
          cliInstalled: true,
          status: "authenticated",
          availableModels: ["opus", "sonnet"],
        },
        codex: {
          platform: "codex",
          cliInstalled: false,
          status: "cli-not-installed",
        },
        kiro: {
          platform: "kiro",
          cliInstalled: true,
          status: "authenticated",
        },
      }),
    });
    expect(out.platforms).toBeDefined();
    expect(Object.keys(out.platforms).sort()).toEqual([
      "claude-code",
      "codex",
      "kiro",
      "opencode",
    ]);
    expect(out.platforms.opencode.status).toBe("authenticated");
    expect(out.platforms.codex.status).toBe("cli-not-installed");
    expect(out.platforms.kiro.cliInstalled).toBe(true);
  });

  it("populates tierMatrix with per-platform resolution for high/balanced/fast", async () => {
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: join(dir, "auth.json"),
      getOpenCodeModels: async () => [
        "amazon-bedrock/anthropic.claude-opus-4-7",
        "amazon-bedrock/anthropic.claude-sonnet-4-6",
      ],
      env: {},
      detectAllPlatforms: async () => ({
        opencode: {
          platform: "opencode",
          cliInstalled: true,
          status: "authenticated",
        },
        "claude-code": {
          platform: "claude-code",
          cliInstalled: true,
          status: "authenticated",
          availableModels: ["opus", "sonnet"],
        },
        codex: {
          platform: "codex",
          cliInstalled: false,
          status: "cli-not-installed",
        },
        kiro: {
          platform: "kiro",
          cliInstalled: true,
          status: "authenticated",
        },
      }),
    });
    expect(out.tierMatrix.length).toBe(3);
    const high = out.tierMatrix.find((t) => t.tier === "high")!;
    // Claude Code resolves via availableModels.
    expect(high.perPlatform["claude-code"]).toBe("opus");
    // Codex CLI not installed → null.
    expect(high.perPlatform.codex).toBeNull();
    // Kiro authenticated → static tier mapping.
    expect(typeof high.perPlatform.kiro).toBe("string");
    // OpenCode resolves via the live model list.
    expect(high.perPlatform.opencode).toBe("amazon-bedrock/anthropic.claude-opus-4-7");
  });

  it("prefers auth.json over live-model inference when both are available", async () => {
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ anthropic: {} }));
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: authPath,
      getOpenCodeModels: async () => ["openai/gpt-5", "openrouter/claude-opus-4.7"],
      env: {},
    });
    // auth.json wins; live-model inference is only the fallback.
    expect(out.detectedProviders).toEqual(["anthropic"]);
  });

  it("reads SMITH_MODEL_PROVIDERS from .env as preference source=file", async () => {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "SMITH_MODEL_PROVIDERS=openrouter,anthropic\n");
    const out = await readModelConfig({
      smithEnvPath: envPath,
      authJsonPath: join(dir, "auth.json"),
      getOpenCodeModels: async () => undefined,
      env: {},
    });
    expect(out.preferenceOrder[0]).toEqual({ provider: "openrouter", source: "file" });
    expect(out.preferenceOrder[1]).toEqual({ provider: "anthropic", source: "file" });
  });

  it("reads SMITH_TIER_X overrides from .env", async () => {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "SMITH_TIER_HIGH=anthropic/custom-opus\n");
    const out = await readModelConfig({
      smithEnvPath: envPath,
      authJsonPath: join(dir, "auth.json"),
      getOpenCodeModels: async () => undefined,
      env: {},
    });
    expect(out.tierOverrides.high).toBe("anthropic/custom-opus");
    expect(out.tierOverrides.balanced).toBeNull();
  });

  it("resolves tier preview with live models", async () => {
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ "github-copilot": {} }));
    const out = await readModelConfig({
      smithEnvPath: join(dir, ".env"),
      authJsonPath: authPath,
      getOpenCodeModels: async () => [
        "github-copilot/claude-opus-4.7",
        "github-copilot/claude-sonnet-4.6",
        "github-copilot/claude-haiku-4.5",
      ],
      env: {},
    });
    const high = out.tierPreview.find((t) => t.tier === "high");
    expect(high?.resolved).toBe("github-copilot/claude-opus-4.7");
    expect(high?.source).toBe("live");
  });
});

describe("writeModelConfig", () => {
  it("writes SMITH_MODEL_PROVIDERS to .env", async () => {
    const envPath = join(dir, ".env");
    await writeModelConfig(
      { preferenceOrder: ["anthropic", "openrouter"] },
      {
        smithEnvPath: envPath,
        authJsonPath: join(dir, "auth.json"),
        getOpenCodeModels: async () => undefined,
        env: {},
      },
    );
    const raw = await readFile(envPath, "utf8");
    expect(raw).toContain("SMITH_MODEL_PROVIDERS=anthropic,openrouter");
  });

  it("writes SMITH_TIER_X overrides to .env", async () => {
    const envPath = join(dir, ".env");
    await writeModelConfig(
      { tierOverrides: { high: "anthropic/custom", balanced: null, fast: null } },
      {
        smithEnvPath: envPath,
        authJsonPath: join(dir, "auth.json"),
        getOpenCodeModels: async () => undefined,
        env: {},
      },
    );
    const raw = await readFile(envPath, "utf8");
    expect(raw).toContain("SMITH_TIER_HIGH=anthropic/custom");
    expect(raw).not.toContain("SMITH_TIER_BALANCED");
  });

  it("round-trips: write then read returns consistent state", async () => {
    const envPath = join(dir, ".env");
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ anthropic: {} }));
    const deps = {
      smithEnvPath: envPath,
      authJsonPath: authPath,
      getOpenCodeModels: async () => undefined as string[] | undefined,
      env: {},
    };
    await writeModelConfig({ preferenceOrder: ["anthropic"] }, deps);
    const out = await readModelConfig(deps);
    expect(out.preferenceOrder[0]).toEqual({ provider: "anthropic", source: "file" });
  });
});
