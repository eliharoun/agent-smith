import { afterEach, describe, expect, test } from "bun:test";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import { runDoctor } from "../../../src/core/freshness/run-doctor";
import type { DoctorDeps, SchemaMeta, ToolMapMeta } from "../../../src/core/freshness/types";

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools",
  notes: "",
};

const codexMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-15",
  verifiedAgainstVersion: "codex v0.7.0",
  sourceUrl: "https://github.com/openai/codex",
  notes: "",
};

const schemaMeta: SchemaMeta = {
  lastVerifiedDate: "2026-05-01",
  sourceUrl: "https://opencode.ai/config.json",
  schemaId: null,
  version: null,
  notes: "",
};

const vendoredSchema = { properties: { agent: { type: "object" } } };

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  const cacheIO = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-02T00:00:00.000Z"),
    readCache: cacheIO.readCache,
    writeCache: cacheIO.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
    ...over,
  };
}

const liveModels = [
  "anthropic/claude-opus-4-7-20260101",
  "anthropic/claude-sonnet-4-6-20260101",
  "anthropic/claude-haiku-4-5-20260101",
  "github-copilot/claude-opus-4.7",
  "github-copilot/claude-sonnet-4.6",
  "github-copilot/claude-haiku-4.5",
];

const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function setEnv(key: string, value: string | undefined) {
  savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("model-resolution provider preview", () => {
  test("happy path: auth detected + live tier match → source='live' for all tiers", async () => {
    setEnv("SMITH_MODEL_PROVIDERS", undefined);
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);

    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["opencode"]),
      modelResolution: {
        getOpenCodeModels: async () => liveModels,
        findOpencodeOnPath: async () => "/usr/bin/opencode",
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "anthropic/claude-opus-4-7-20260101",
          balanced: "anthropic/claude-sonnet-4-6-20260101",
          fast: "anthropic/claude-haiku-4-5-20260101",
        },
        detectAuthenticatedProviders: async () => ["anthropic", "github-copilot"],
      },
    });

    const mr = report.modelResolution!;
    expect(mr.detectedProviders).toEqual(["anthropic", "github-copilot"]);
    expect(mr.preferenceOrder).toEqual([
      { provider: "github-copilot", source: "default" },
      { provider: "anthropic", source: "default" },
    ]);
    expect(mr.tierPreview).toHaveLength(3);
    for (const t of mr.tierPreview) {
      expect(t.source).toBe("live");
      expect(t.resolved).not.toBeNull();
    }
  });

  test("SMITH_MODEL_PROVIDERS overrides default ordering", async () => {
    setEnv("SMITH_MODEL_PROVIDERS", "openai,anthropic");
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);

    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["opencode"]),
      modelResolution: {
        getOpenCodeModels: async () => liveModels,
        findOpencodeOnPath: async () => "/usr/bin/opencode",
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "anthropic/claude-opus-4-7-20260101",
          balanced: "anthropic/claude-sonnet-4-6-20260101",
          fast: "anthropic/claude-haiku-4-5-20260101",
        },
        detectAuthenticatedProviders: async () => ["anthropic"],
      },
    });

    const mr = report.modelResolution!;
    expect(mr.preferenceOrder).toEqual([
      { provider: "openai", source: "env" },
      { provider: "anthropic", source: "env" },
    ]);
  });

  test("tier unresolvable → source='failed' + hint message", async () => {
    setEnv("SMITH_MODEL_PROVIDERS", undefined);
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);

    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["opencode"]),
      modelResolution: {
        getOpenCodeModels: async () => ["some-unknown/model-x"],
        findOpencodeOnPath: async () => "/usr/bin/opencode",
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "anthropic/claude-opus-4-7-20260101",
          balanced: "anthropic/claude-sonnet-4-6-20260101",
          fast: "anthropic/claude-haiku-4-5-20260101",
        },
        detectAuthenticatedProviders: async () => [],
      },
    });

    const mr = report.modelResolution!;
    for (const t of mr.tierPreview) {
      expect(t.source).toBe("failed");
      expect(t.resolved).toBeNull();
      expect(t.message).toContain("SMITH_TIER_");
    }
  });

  test("doctor doesn't crash when SmithError thrown internally for one tier", async () => {
    setEnv("SMITH_MODEL_PROVIDERS", undefined);
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);

    // Provide a model list that only resolves 'fast' tier
    const partialModels = ["anthropic/claude-haiku-4-5-20260101"];

    const report = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      installedPlatforms: new Set(["opencode"]),
      modelResolution: {
        getOpenCodeModels: async () => partialModels,
        findOpencodeOnPath: async () => "/usr/bin/opencode",
        installedPaths: {
          opencodeAgentsDir: "/x",
          claudeCodeAgentsDir: "/y",
          codexAgentsDir: "/z",
        },
        curatedFallback: {
          high: "anthropic/claude-opus-4-7-20260101",
          balanced: "anthropic/claude-sonnet-4-6-20260101",
          fast: "anthropic/claude-haiku-4-5-20260101",
        },
        detectAuthenticatedProviders: async () => ["anthropic"],
      },
    });

    // Doctor must not crash
    expect(report).toBeDefined();
    expect(report.modelResolution).toBeDefined();
    const mr = report.modelResolution!;

    // fast should resolve (curated fallback is in the list)
    const fast = mr.tierPreview.find((t) => t.tier === "fast");
    expect(fast?.resolved).not.toBeNull();

    // high and balanced should fail gracefully
    const high = mr.tierPreview.find((t) => t.tier === "high");
    const balanced = mr.tierPreview.find((t) => t.tier === "balanced");
    expect(high?.source).toBe("failed");
    expect(balanced?.source).toBe("failed");
  });
});
