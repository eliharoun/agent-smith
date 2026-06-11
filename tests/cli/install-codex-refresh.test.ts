import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import { readRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import { translateClaudeCode } from "../../src/core/translators";
import type { AgentBundle, InstallPaths, ResolvedModelContext } from "../../src/core/types";
import { readCodexHooks } from "../../src/io/codex-hooks";
import type { BuildAndInstallOptions, OrchestratorResult } from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const emptyResult: OrchestratorResult = {
  installed: [],
  skipped: [],
  warnings: [],
  errors: [],
  grantedKnowledgeDirs: [],
  knowledge: [],
};

/**
 * Mirror of `tests/cli/install-refresh-consent.test.ts` for the codex
 * platform. Builds a bundle whose canonical config targets codex and
 * declares one session-mode source. Phase-3 tests cover the same scenarios
 * for claude-code; this file pins the codex-specific side effects.
 */
function bundleWithSessionSource(name: string): AgentBundle {
  const b = fakeBundle(name, { targets: ["codex"] });
  b.config.knowledge = {
    sources: [
      {
        id: "live-docs",
        type: "webpage",
        url: "https://example.com",
        delivery: "file",
        refresh: { mode: "session" },
      },
    ],
  };
  return b;
}

const fakeRegistry: Registry = { schemaVersion: 2, sources: [] };
const fakePaths: InstallPaths = {
  opencode: "/fake/opencode",
  "claude-code": "/fake/claude",
  codex: "/fake/codex",
  kiro: "/fake/kiro",
  "agents-md": "/fake/agents-md",
};

// Pretend every CLI is detected so the install pipeline doesn't drop the
// codex/claude-code targets these tests rely on. Without this stub the
// detection would consult the live PATH and skip targets, defeating the
// per-platform consent assertions below.
const ALL_DETECTED = async () =>
  new Set(["opencode", "claude-code", "codex", "kiro"] as const);

describe("install codex refresh consent", () => {
  let agentHome: string;
  let codexHome: string;
  beforeEach(async () => {
    agentHome = await mkdtemp(join(tmpdir(), "install-codex-agent-"));
    codexHome = await mkdtemp(join(tmpdir(), "install-codex-home-"));
  });
  afterEach(async () => {
    await rm(agentHome, { recursive: true, force: true });
    await rm(codexHome, { recursive: true, force: true });
  });

  test("--refresh-consent yes registers agent in ~/.codex/hooks.json and writes manifest", async () => {
    const exit = await install({
      name: "codex-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "yes" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("codex-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      detectInstalledPlatforms: ALL_DETECTED,
      agentSmithHome: agentHome,
      codexHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const hooks = await readCodexHooks(codexHome);
    expect(hooks?._smith_managed.agents).toContain("codex-agent");
    const manifest = await readRefreshManifest(agentHome, "codex-agent");
    expect(manifest?.refresh_consent.platforms).toContain("codex");
    expect(manifest?.refresh_consent.sources).toContain("live-docs");
  });

  test("--refresh-consent no does NOT touch ~/.codex/hooks.json", async () => {
    const exit = await install({
      name: "codex-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "no" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("codex-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: agentHome,
      codexHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const hooks = await readCodexHooks(codexHome);
    expect(hooks).toBeUndefined();
    const manifest = await readRefreshManifest(agentHome, "codex-agent");
    expect(manifest).toBeUndefined();
  });

  test("--no-refresh-hooks skips codex hook registration entirely", async () => {
    const exit = await install({
      name: "codex-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      noRefreshHooks: true,
      // Even if we ALSO pass refreshConsent yes, --no-refresh-hooks wins
      // (matches the phase-3 contract: short-circuit before any consent).
      refreshConsent: { kind: "scalar", value: "yes" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("codex-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: agentHome,
      codexHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const hooks = await readCodexHooks(codexHome);
    expect(hooks).toBeUndefined();
    const manifest = await readRefreshManifest(agentHome, "codex-agent");
    expect(manifest).toBeUndefined();
  });

  test("multi-target (claude-code + codex) with consent registers both platforms", async () => {
    // Bundle whose canonical config targets BOTH platforms with one
    // session-mode source. Consent granted ⇒ codex hooks.json gets the
    // agent, claude-code bundle is opted-in for hook frontmatter
    // emission, and the manifest records consent for both platforms.
    const bundle = fakeBundle("multi-agent", {
      targets: ["claude-code", "codex"],
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "live-docs",
          type: "webpage",
          url: "https://example.com",
          delivery: "file",
          refresh: { mode: "session" },
        },
      ],
    };

    // Capture the withRefreshHooksFor map so we can assert claude-code
    // emission was opted-in (mirrors phase-3 test pattern in
    // install-refresh-consent.test.ts — direct file-on-disk inspection
    // isn't possible here because buildAndInstall is mocked).
    let capturedMap: Map<string, boolean> | undefined;
    const capture = async (
      _bundles: AgentBundle[],
      _paths: InstallPaths,
      options?: BuildAndInstallOptions,
    ): Promise<OrchestratorResult> => {
      capturedMap = options?.withRefreshHooksFor;
      return emptyResult;
    };

    const exit = await install({
      name: "multi-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "yes" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: capture,
      detectInstalledPlatforms: ALL_DETECTED,
      agentSmithHome: agentHome,
      codexHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);

    // (1) Codex hooks.json registration.
    const hooks = await readCodexHooks(codexHome);
    expect(hooks?._smith_managed.agents).toContain("multi-agent");

    // (2) Manifest records consent for BOTH platforms.
    const manifest = await readRefreshManifest(agentHome, "multi-agent");
    expect(manifest?.refresh_consent.platforms).toEqual(
      expect.arrayContaining(["claude-code", "codex"]),
    );
    expect(manifest?.refresh_consent.sources).toContain("live-docs");

    // (3) Claude-code bundle was opted-in for hook frontmatter emission.
    // Verified by feeding the captured opt-in state into the translator
    // and asserting it produces the SessionStart hook block.
    expect(capturedMap?.get("multi-agent")).toBe(true);
    const ctx: ResolvedModelContext = {
      resolvedModel: undefined,
      withRefreshHooks: true,
    };
    const rendered = translateClaudeCode(bundle.config, "body", ctx);
    if (rendered.format !== "markdown-frontmatter") {
      throw new Error(`expected markdown-frontmatter, got ${rendered.format}`);
    }
    expect(rendered.frontmatter.hooks).toBeDefined();
  });
});
