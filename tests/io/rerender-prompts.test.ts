import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import { type RerenderPromptsDeps, rerenderPrompts } from "../../src/io/rerender-prompts";

const stubModelEnv: ModelResolutionEnv = {
  getOpenCodeModels: async () => undefined,
  warnings: { push() {} },
};

describe("rerenderPrompts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-rerender-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("happy path: existing manifest + bundle on disk; rerender writes to per-platform install paths", async () => {
    // Set up a knowledge dir with a manifest
    const knowledgeDir = join(dir, "knowledge", "test-agent");
    await mkdir(knowledgeDir, { recursive: true });
    const manifest = {
      schemaVersion: 1,
      renderedAt: "2026-05-27T00:00:00.000Z",
      sources: [
        {
          id: "src-a",
          scope: "agent",
          type: "url",
          delivery: "file",
          files: [
            { path: "sources/src-a/index.md", sha256: "abc", bytes: 100, summary: "API docs" },
          ],
          fetchedAt: "2026-05-27T00:00:00.000Z",
          extractor: null,
          tokensInline: 0,
          description: "API reference",
        },
      ],
      totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 1, bytes: 100 },
    };
    await writeFile(join(knowledgeDir, "_manifest.json"), JSON.stringify(manifest));

    // Track what installRendered receives
    const installCalls: unknown[] = [];
    const mockInstallRendered = mock(async (rendered: unknown[], _paths: unknown) => {
      installCalls.push(rendered);
      return { installed: [{ target: "opencode", path: "/fake" }], skipped: [], warnings: [] };
    });

    // Fake bundle
    const fakeBundle = {
      config: {
        name: "test-agent",
        targets: ["opencode"] as const,
        knowledge: { sources: [{ id: "src-a", type: "url", delivery: "file" }] },
        skills: [],
      },
      files: { identity: "# Identity", expertise: "# Expertise", soul: "# Soul", user: "# User" },
      bundlePath: "/fake/bundle",
      source: { kind: "user-global", rootPath: dir, label: "test" },
    };
    const mockLoadAllBundles = mock(async () => ({
      bundles: [fakeBundle],
      failures: [],
    }));
    const mockLoadRegistry = mock(async () => ({ sources: [] }));

    const result = await rerenderPrompts("test-agent", {
      agentSmithHome: dir,
      loadRegistry: mockLoadRegistry as unknown as NonNullable<RerenderPromptsDeps["loadRegistry"]>,
      loadAllBundles: mockLoadAllBundles as unknown as NonNullable<RerenderPromptsDeps["loadAllBundles"]>,
      installRendered: mockInstallRendered as unknown as NonNullable<RerenderPromptsDeps["installRendered"]>,
      modelResolutionEnv: stubModelEnv,
    });

    expect(result.ok).toBe(true);
    expect(installCalls).toHaveLength(1);
    // Rendered agents should have been passed to installRendered
    const rendered = installCalls[0] as unknown[];
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("no-knowledge bundle: rerender skips knowledge section gracefully", async () => {
    // No manifest on disk, no knowledge sources in bundle
    const knowledgeDir = join(dir, "knowledge", "no-knowledge-agent");
    await mkdir(knowledgeDir, { recursive: true });
    // Write an empty manifest
    const manifest = {
      schemaVersion: 1,
      renderedAt: "2026-05-27T00:00:00.000Z",
      sources: [],
      totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 0, bytes: 0 },
    };
    await writeFile(join(knowledgeDir, "_manifest.json"), JSON.stringify(manifest));

    const installCalls: unknown[] = [];
    const mockInstallRendered = mock(async (rendered: unknown[], _paths: unknown) => {
      installCalls.push(rendered);
      return { installed: [], skipped: [], warnings: [] };
    });

    const fakeBundle = {
      config: {
        name: "no-knowledge-agent",
        targets: ["opencode"] as const,
        knowledge: undefined,
        skills: [],
      },
      files: { identity: "# Identity", expertise: "# Expertise", soul: "# Soul", user: "# User" },
      bundlePath: "/fake/bundle",
      source: { kind: "user-global", rootPath: dir, label: "test" },
    };
    const mockLoadAllBundles = mock(async () => ({
      bundles: [fakeBundle],
      failures: [],
    }));
    const mockLoadRegistry = mock(async () => ({ sources: [] }));

    const result = await rerenderPrompts("no-knowledge-agent", {
      agentSmithHome: dir,
      loadRegistry: mockLoadRegistry as unknown as NonNullable<RerenderPromptsDeps["loadRegistry"]>,
      loadAllBundles: mockLoadAllBundles as unknown as NonNullable<RerenderPromptsDeps["loadAllBundles"]>,
      installRendered: mockInstallRendered as unknown as NonNullable<RerenderPromptsDeps["installRendered"]>,
      modelResolutionEnv: stubModelEnv,
    });

    expect(result.ok).toBe(true);
    expect(installCalls).toHaveLength(1);
  });

  it("manifest missing: rerender returns ok:false cleanly", async () => {
    // No manifest file at all
    const knowledgeDir = join(dir, "knowledge", "missing-manifest-agent");
    await mkdir(knowledgeDir, { recursive: true });
    // Don't write _manifest.json

    const mockInstallRendered = mock(async () => ({
      installed: [],
      skipped: [],
      warnings: [],
    }));

    const fakeBundle = {
      config: {
        name: "missing-manifest-agent",
        targets: ["opencode"] as const,
        knowledge: { sources: [{ id: "src-a", type: "url", delivery: "file" }] },
        skills: [],
      },
      files: { identity: "# Identity", expertise: "# Expertise", soul: "# Soul", user: "# User" },
      bundlePath: "/fake/bundle",
      source: { kind: "user-global", rootPath: dir, label: "test" },
    };
    const mockLoadAllBundles = mock(async () => ({
      bundles: [fakeBundle],
      failures: [],
    }));
    const mockLoadRegistry = mock(async () => ({ sources: [] }));

    const result = await rerenderPrompts("missing-manifest-agent", {
      agentSmithHome: dir,
      loadRegistry: mockLoadRegistry as unknown as NonNullable<RerenderPromptsDeps["loadRegistry"]>,
      loadAllBundles: mockLoadAllBundles as unknown as NonNullable<RerenderPromptsDeps["loadAllBundles"]>,
      installRendered: mockInstallRendered as unknown as NonNullable<RerenderPromptsDeps["installRendered"]>,
      modelResolutionEnv: stubModelEnv,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("manifest");
    }
    // installRendered should NOT have been called
    expect(mockInstallRendered).not.toHaveBeenCalled();
  });

  it("multi-target bundle: opencode resolution failure does NOT crash the rerender (claude-code still installs)", async () => {
    // Regression for the user-facing bug: `smith knowledge fetch
    // agent-smith` errored with `model resolution failed for tier
    // 'high'` when amazon-bedrock wasn't authenticated, even though the
    // bundle is also installed for claude-code (which doesn't depend on
    // OpenCode auth at all). The orchestrator already swallowed
    // per-target failures into warnings; rerenderPrompts wasn't doing
    // the same — same fix shape.
    const knowledgeDir = join(dir, "knowledge", "multi-target");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(
      join(knowledgeDir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-29T00:00:00.000Z",
        sources: [],
        totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 0, bytes: 0 },
      }),
    );

    // Inject a model env where opencode resolver throws but claude-code
    // resolves cleanly. Claude Code's resolver consults
    // detectClaudeCodeAuth from the env, so we provide it.
    const failingEnv: ModelResolutionEnv = {
      getOpenCodeModels: async () => undefined,
      warnings: { push() {} },
      detectAuthenticatedProviders: async () => [],
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: true,
        status: "authenticated",
        availableModels: ["opus", "sonnet"],
      }),
    };

    const installCalls: unknown[] = [];
    const mockInstallRendered = mock(async (rendered: unknown[], _paths: unknown) => {
      installCalls.push(rendered);
      return {
        installed: [{ target: "claude-code", path: "/fake/claude.md" }],
        skipped: [],
        warnings: [],
      };
    });

    const fakeBundle = {
      config: {
        name: "multi-target",
        targets: ["opencode", "claude-code"] as const,
        modelTier: "high" as const,
        knowledge: undefined,
        skills: [],
      },
      files: {
        identity: "# Identity",
        expertise: "# Expertise",
        soul: "# Soul",
        user: "# User",
      },
      bundlePath: "/fake/bundle",
      source: { kind: "user-global", rootPath: dir, label: "test" },
    };
    const mockLoadAllBundles = mock(async () => ({ bundles: [fakeBundle], failures: [] }));
    const mockLoadRegistry = mock(async () => ({ sources: [] }));

    const result = await rerenderPrompts("multi-target", {
      agentSmithHome: dir,
      loadRegistry: mockLoadRegistry as unknown as NonNullable<RerenderPromptsDeps["loadRegistry"]>,
      loadAllBundles: mockLoadAllBundles as unknown as NonNullable<RerenderPromptsDeps["loadAllBundles"]>,
      installRendered: mockInstallRendered as unknown as NonNullable<RerenderPromptsDeps["installRendered"]>,
      modelResolutionEnv: failingEnv,
    });

    // The whole rerender succeeds even though one target failed; the
    // installer was called once with the surviving render(s).
    expect(result.ok).toBe(true);
    expect(installCalls).toHaveLength(1);
  });

  it("multi-target bundle: ALL platforms missing CLI → ok:false, no install attempt", async () => {
    // When every declared target throws PlatformUnavailableError (no
    // CLI installed for any of them), we have nothing to render. Return
    // ok:false rather than write an empty install.
    const knowledgeDir = join(dir, "knowledge", "all-fail");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(
      join(knowledgeDir, "_manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        renderedAt: "2026-05-29T00:00:00.000Z",
        sources: [],
        totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 0, bytes: 0 },
      }),
    );

    const failingEnv: ModelResolutionEnv = {
      getOpenCodeModels: async () => undefined,
      warnings: { push() {} },
      detectAuthenticatedProviders: async () => [],
      detectClaudeCodeAuth: async () => ({
        platform: "claude-code",
        cliInstalled: false,
        status: "cli-not-installed",
      }),
      detectCodexAuth: async () => ({
        platform: "codex",
        cliInstalled: false,
        status: "cli-not-installed",
      }),
    };

    const mockInstallRendered = mock(async () => ({ installed: [], skipped: [], warnings: [] }));
    const fakeBundle = {
      config: {
        name: "all-fail",
        targets: ["claude-code", "codex"] as const,
        modelTier: "high" as const,
        knowledge: undefined,
        skills: [],
      },
      files: {
        identity: "# Identity",
        expertise: "# Expertise",
        soul: "# Soul",
        user: "# User",
      },
      bundlePath: "/fake/bundle",
      source: { kind: "user-global", rootPath: dir, label: "test" },
    };
    const mockLoadAllBundles = mock(async () => ({ bundles: [fakeBundle], failures: [] }));
    const mockLoadRegistry = mock(async () => ({ sources: [] }));

    const result = await rerenderPrompts("all-fail", {
      agentSmithHome: dir,
      loadRegistry: mockLoadRegistry as unknown as NonNullable<RerenderPromptsDeps["loadRegistry"]>,
      loadAllBundles: mockLoadAllBundles as unknown as NonNullable<RerenderPromptsDeps["loadAllBundles"]>,
      installRendered: mockInstallRendered as unknown as NonNullable<RerenderPromptsDeps["installRendered"]>,
      modelResolutionEnv: failingEnv,
    });

    expect(result.ok).toBe(false);
    expect(mockInstallRendered).not.toHaveBeenCalled();
  });
});
