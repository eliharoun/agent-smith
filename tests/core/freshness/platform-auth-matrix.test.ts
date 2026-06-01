/**
 * Tests for the per-platform auth matrix that the refactored doctor
 * surfaces in its `modelResolution` section. Verifies:
 *   - Each platform reports its own readiness independently.
 *   - Tier preview is per-platform, not just OpenCode.
 *   - Exit code is driven by installed-agent footprint, not global readiness.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { makeMemoryCacheIO } from "../../../src/core/freshness/cache";
import { runDoctor } from "../../../src/core/freshness/run-doctor";
import type { DoctorDeps, SchemaMeta, ToolMapMeta } from "../../../src/core/freshness/types";
import type { PlatformAuth } from "../../../src/io/auth/types";

const claudeMeta: ToolMapMeta = {
  lastVerifiedDate: "2026-04-20",
  verifiedAgainstVersion: "claude-code v0.42.0",
  sourceUrl: "https://docs.anthropic.com/",
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

function deps(): DoctorDeps {
  const cacheIO = makeMemoryCacheIO();
  return {
    fetch: async () => new Response(JSON.stringify(vendoredSchema), { status: 200 }),
    now: () => new Date("2026-05-29T00:00:00.000Z"),
    readCache: cacheIO.readCache,
    writeCache: cacheIO.writeCache,
    cachePath: "/tmp/cache.json",
    ttlMs: 24 * 60 * 60 * 1000,
    offline: false,
    noCache: false,
  };
}

const savedEnv: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

const claudeAuthed: PlatformAuth = {
  platform: "claude-code",
  cliInstalled: true,
  status: "authenticated",
  availableModels: ["opus", "sonnet"],
  detail: "available models: opus, sonnet",
};

const opencodeUnauthed: PlatformAuth = {
  platform: "opencode",
  cliInstalled: true,
  status: "unauthenticated",
  detail: "no providers configured",
};

const codexNotInstalled: PlatformAuth = {
  platform: "codex",
  cliInstalled: false,
  status: "cli-not-installed",
};

const kiroAuthed: PlatformAuth = {
  platform: "kiro",
  cliInstalled: true,
  status: "authenticated",
  detail: "logged in (IdC)",
};

// AGENTS.md is a markdown contract — no CLI, no auth surface to probe.
// Used to fill the matrix for tests so it satisfies PlatformAuthMatrix
// after the T5a Target widening.
const agentsMdNotInstalled: PlatformAuth = {
  platform: "agents-md",
  cliInstalled: false,
  status: "cli-not-installed",
  detail: "AGENTS.md is a markdown contract — no CLI to authenticate",
};

/**
 * Build a minimal RunDoctor input keyed off a platformAuth matrix.
 * Used by exit-code-policy tests below.
 */
function makeInputWithMatrix(matrixOverrides: Partial<{
  opencode: PlatformAuth;
  "claude-code": PlatformAuth;
  codex: PlatformAuth;
  kiro: PlatformAuth;
  "agents-md": PlatformAuth;
}>): Parameters<typeof runDoctor>[0] {
  const matrix = {
    opencode: {
      platform: "opencode" as const,
      cliInstalled: true,
      status: "authenticated" as const,
    },
    "claude-code": {
      platform: "claude-code" as const,
      cliInstalled: true,
      status: "authenticated" as const,
    },
    codex: {
      platform: "codex" as const,
      cliInstalled: false,
      status: "cli-not-installed" as const,
    },
    kiro: {
      platform: "kiro" as const,
      cliInstalled: true,
      status: "authenticated" as const,
    },
    "agents-md": agentsMdNotInstalled,
    ...matrixOverrides,
  };
  return {
    vendoredSchema,
    schemaMeta,
    claudeMeta,
    codexMeta,
    deps: deps(),
    modelResolution: {
      findOpencodeOnPath: async () => "/usr/local/bin/opencode",
      getOpenCodeModels: async () =>
        // Live list provides the curated fallbacks so drift is not the
        // reason these tests would warn.
        [
          "github-copilot/claude-opus-4.7",
          "github-copilot/claude-sonnet-4.6",
          "github-copilot/claude-haiku-4.5",
        ],
      installedPaths: {
        opencodeAgentsDir: "/tmp/none",
        claudeCodeAgentsDir: "/tmp/none",
        codexAgentsDir: "/tmp/none",
      },
      curatedFallback: {
        high: "github-copilot/claude-opus-4.7",
        balanced: "github-copilot/claude-sonnet-4.6",
        fast: "github-copilot/claude-haiku-4.5",
      },
      detectAuthenticatedProviders: async () => ["github-copilot"],
      platformAuth: matrix,
    },
  };
}

describe("doctor: per-platform exit-code policy", () => {
  test("does NOT warn when an unauthenticated platform has no installed agents", async () => {
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);
    setEnv("SMITH_MODEL_PROVIDERS", undefined);

    const events: Array<{ id: string; status?: string }> = [];
    const result = await runDoctor({
      ...makeInputWithMatrix({
        // OpenCode is unauthenticated, but no agents are installed for it.
        opencode: opencodeUnauthed,
      }),
      onSectionDone: (e) => events.push({ id: e.id, status: e.status }),
    });
    const modelEvent = events.find((e) => e.id === "model-resolution");
    expect(modelEvent?.status).toBe("ok");
    expect(result.exitCode).toBe(0);
  });
});

describe("doctor: per-platform auth matrix", () => {
  test("includes a platforms map covering every Target", async () => {
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);
    setEnv("SMITH_MODEL_PROVIDERS", undefined);

    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      modelResolution: {
        findOpencodeOnPath: async () => "/usr/local/bin/opencode",
        getOpenCodeModels: async () => undefined,
        installedPaths: {
          opencodeAgentsDir: "/tmp/none",
          claudeCodeAgentsDir: "/tmp/none",
          codexAgentsDir: "/tmp/none",
        },
        curatedFallback: {
          high: "github-copilot/claude-opus-4.7",
          balanced: "github-copilot/claude-sonnet-4.6",
          fast: "github-copilot/claude-haiku-4.5",
        },
        detectAuthenticatedProviders: async () => [],
        platformAuth: {
          opencode: opencodeUnauthed,
          "claude-code": claudeAuthed,
          codex: codexNotInstalled,
          kiro: kiroAuthed,
          "agents-md": agentsMdNotInstalled,
        },
      },
    });

    expect(result.modelResolution).toBeDefined();
    expect(result.modelResolution?.platforms).toBeDefined();
    const platforms = result.modelResolution?.platforms;
    expect(platforms?.opencode.status).toBe("unauthenticated");
    expect(platforms?.["claude-code"].status).toBe("authenticated");
    expect(platforms?.codex.status).toBe("cli-not-installed");
    expect(platforms?.kiro.status).toBe("authenticated");
  });

  test("tier preview reports per-platform resolution, not just OpenCode", async () => {
    setEnv("SMITH_TIER_HIGH", undefined);
    setEnv("SMITH_TIER_BALANCED", undefined);
    setEnv("SMITH_TIER_FAST", undefined);
    setEnv("SMITH_MODEL_PROVIDERS", undefined);

    const result = await runDoctor({
      vendoredSchema,
      schemaMeta,
      claudeMeta,
      codexMeta,
      deps: deps(),
      modelResolution: {
        findOpencodeOnPath: async () => "/usr/local/bin/opencode",
        getOpenCodeModels: async () => undefined,
        installedPaths: {
          opencodeAgentsDir: "/tmp/none",
          claudeCodeAgentsDir: "/tmp/none",
          codexAgentsDir: "/tmp/none",
        },
        curatedFallback: {
          high: "github-copilot/claude-opus-4.7",
          balanced: "github-copilot/claude-sonnet-4.6",
          fast: "github-copilot/claude-haiku-4.5",
        },
        detectAuthenticatedProviders: async () => [],
        platformAuth: {
          opencode: opencodeUnauthed,
          "claude-code": claudeAuthed,
          codex: codexNotInstalled,
          kiro: kiroAuthed,
          "agents-md": agentsMdNotInstalled,
        },
      },
    });

    const tier = result.modelResolution?.tierPreview;
    expect(tier).toBeDefined();
    // Every tier entry should now have per-platform resolution.
    const high = tier?.find((t) => t.tier === "high");
    expect(high).toBeDefined();
    expect(high?.perPlatform).toBeDefined();
    // Claude Code is authenticated → should resolve "opus".
    expect(high?.perPlatform?.["claude-code"]).toBe("opus");
    // OpenCode is unauthenticated → should be null.
    expect(high?.perPlatform?.opencode).toBeNull();
    // Codex CLI not installed → null.
    expect(high?.perPlatform?.codex).toBeNull();
    // Kiro is authenticated → should resolve to its tier literal.
    expect(typeof high?.perPlatform?.kiro).toBe("string");
  });
});
