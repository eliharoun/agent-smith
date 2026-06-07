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
 * Build a fake bundle whose canonical config declares one session-mode
 * knowledge source. The plan's `fixture()` helper was specified as a
 * real on-disk bundle, but the existing install tests inject bundles
 * via the `loadAllBundles` DI seam (see tests/cli/install.test.ts), so
 * we follow that pattern — no temp bundle dir or registry needed.
 */
function bundleWithSessionSource(name: string): AgentBundle {
  const b = fakeBundle(name, { targets: ["claude-code"] });
  b.config.knowledge = {
    sources: [
      {
        id: "live-docs",
        type: "url",
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

describe("install refresh consent", () => {
  let workDir: string;
  let codexHome: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "install-consent-"));
    codexHome = await mkdtemp(join(tmpdir(), "install-consent-codex-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(codexHome, { recursive: true, force: true });
  });

  test("writes refresh-manifest when user consents (y)", async () => {
    const exit = await install({
      name: "test-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      prompt: async () => "y",
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("test-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: workDir,
      codexHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const manifest = await readRefreshManifest(workDir, "test-agent");
    expect(manifest?.refresh_consent.platforms).toContain("claude-code");
    expect(manifest?.refresh_consent.sources).toContain("live-docs");
    // Defense in depth: a claude-code-only bundle MUST NOT register
    // anything in ~/.codex/hooks.json, even when consent is granted.
    expect(await readCodexHooks(codexHome)).toBeUndefined();
  });

  test("does NOT write manifest when user declines (n)", async () => {
    const exit = await install({
      name: "test-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      prompt: async () => "n",
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("test-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const manifest = await readRefreshManifest(workDir, "test-agent");
    expect(manifest).toBeUndefined();
  });

  test("--refresh-consent yes bypasses prompt", async () => {
    let promptCalled = false;
    const exit = await install({
      name: "test-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      refreshConsent: { kind: "scalar", value: "yes" },
      prompt: async () => {
        promptCalled = true;
        return "n";
      },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("test-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    expect(promptCalled).toBe(false);
    const manifest = await readRefreshManifest(workDir, "test-agent");
    expect(manifest?.refresh_consent.platforms).toContain("claude-code");
  });

  test("--no-refresh-hooks skips consent and manifest entirely", async () => {
    let promptCalled = false;
    const exit = await install({
      name: "test-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      noRefreshHooks: true,
      prompt: async () => {
        promptCalled = true;
        return "y";
      },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("test-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    expect(promptCalled).toBe(false);
    const manifest = await readRefreshManifest(workDir, "test-agent");
    expect(manifest).toBeUndefined();
  });

  // ---- Regression tests for orphan-hook bug ----
  // Before the fix, the translator unconditionally emitted a SessionStart
  // hook block whenever a source had refresh.mode session|always, regardless
  // of consent. That meant `--no-refresh-hooks` or declining the prompt
  // still left a hook in the rendered file, firing `smith knowledge
  // refresh-session` on every Claude session with no manifest backing it.
  //
  // We assert two things end-to-end:
  //   1. install() passes a `withRefreshHooksFor` map to buildAndInstall
  //      that does NOT mark the bundle as opted in.
  //   2. Feeding that map's value (undefined) into translateClaudeCode
  //      for a session-mode source yields no hooks frontmatter.
  // Together these prove the consent-to-translator wiring is correct;
  // the direct translator tests in claude-code-hooks.test.ts cover the
  // gate semantics in isolation.

  function captureRefreshHooksFor(): {
    capture: (
      bundles: AgentBundle[],
      paths: InstallPaths,
      options?: BuildAndInstallOptions,
    ) => Promise<OrchestratorResult>;
    getMap: () => Map<string, boolean> | undefined;
  } {
    let captured: Map<string, boolean> | undefined;
    return {
      capture: async (_bundles, _paths, options) => {
        captured = options?.withRefreshHooksFor;
        return emptyResult;
      },
      getMap: () => captured,
    };
  }

  test("--no-refresh-hooks does NOT opt-in any bundle for hook emission", async () => {
    const { capture, getMap } = captureRefreshHooksFor();
    const bundle = bundleWithSessionSource("orphan-hook-check");
    const exit = await install({
      name: "orphan-hook-check",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      noRefreshHooks: true,
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: capture,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    // The wiring contract: the map MUST NOT contain a `true` entry for
    // this bundle. (Either absent, or explicitly absent — both render
    // hooks-free per orchestrator + renderForTargets.)
    const map = getMap();
    expect(map?.get("orphan-hook-check")).toBeUndefined();

    // Confirm the translator with this exact ctx state produces no hooks.
    const ctx: ResolvedModelContext = {
      resolvedModel: undefined,
      ...(map?.get("orphan-hook-check") === true
        ? { withRefreshHooks: true }
        : {}),
    };
    const rendered = translateClaudeCode(bundle.config, "body", ctx);
    if (rendered.format !== "markdown-frontmatter") {
      throw new Error(`expected markdown-frontmatter, got ${rendered.format}`);
    }
    expect(rendered.frontmatter.hooks).toBeUndefined();
    // And no manifest was written.
    const manifest = await readRefreshManifest(workDir, "orphan-hook-check");
    expect(manifest).toBeUndefined();
  });

  test("declined consent (n) does NOT opt-in the bundle for hook emission", async () => {
    const { capture, getMap } = captureRefreshHooksFor();
    const bundle = bundleWithSessionSource("declined-hook-check");
    const exit = await install({
      name: "declined-hook-check",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      prompt: async () => "n",
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: capture,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    const map = getMap();
    expect(map?.get("declined-hook-check")).toBeUndefined();
    const ctx: ResolvedModelContext = {
      resolvedModel: undefined,
      ...(map?.get("declined-hook-check") === true
        ? { withRefreshHooks: true }
        : {}),
    };
    const rendered = translateClaudeCode(bundle.config, "body", ctx);
    if (rendered.format !== "markdown-frontmatter") {
      throw new Error(`expected markdown-frontmatter, got ${rendered.format}`);
    }
    expect(rendered.frontmatter.hooks).toBeUndefined();
    const manifest = await readRefreshManifest(workDir, "declined-hook-check");
    expect(manifest).toBeUndefined();
  });

  test("consent loop does not prompt for platforms not on PATH", async () => {
    // Bundle declares all four CLIs as targets, but only claude-code is
    // detected on PATH. The consent loop MUST prompt only for claude-code.
    // Regression: previously the loop iterated `bundle.config.targets`
    // filtered solely by CONSENT_PLATFORMS, which would prompt for codex
    // and opencode even when their CLIs weren't installed.
    const bundle = fakeBundle("multi-target", {
      targets: ["opencode", "claude-code", "codex", "kiro"],
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "live-docs",
          type: "url",
          url: "https://example.com",
          delivery: "file",
          refresh: { mode: "session" },
        },
      ],
    };

    const promptedPlatforms: string[] = [];
    const stderrLines: string[] = [];
    const exit = await install({
      name: "multi-target",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      // Claude-only detection. opencode/codex/kiro are NOT on PATH.
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      // Force TTY so the consent loop reaches the prompt branch (the
      // non-TTY branch would skip silently — distinct path).
      isTTY: () => true,
      prompt: async () => "y",
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: workDir,
      codexHome,
      print: () => {},
      printErr: (msg) => {
        stderrLines.push(msg);
        // `printConsentPrompt` emits a line of the form
        //   "To enable auto-refresh on <platform>, ..."
        const m = msg.match(/^To enable auto-refresh on ([\w-]+)/);
        if (m && m[1]) promptedPlatforms.push(m[1]);
      },
    });
    expect(exit).toBe(0);
    // Only claude-code should have triggered a consent prompt.
    expect(promptedPlatforms).toEqual(["claude-code"]);
    expect(promptedPlatforms).not.toContain("opencode");
    expect(promptedPlatforms).not.toContain("codex");
    expect(promptedPlatforms).not.toContain("kiro");
    // Sanity: codex hooks file must NOT have been touched (no consent
    // ever recorded for codex).
    expect(await readCodexHooks(codexHome)).toBeUndefined();
    // And the manifest reflects only claude-code consent.
    const manifest = await readRefreshManifest(workDir, "multi-target");
    expect(manifest?.refresh_consent.platforms).toEqual(["claude-code"]);
  });

  test("consent granted DOES opt-in the bundle for hook emission", async () => {
    const { capture, getMap } = captureRefreshHooksFor();
    const bundle = bundleWithSessionSource("approved-hook-check");
    const exit = await install({
      name: "approved-hook-check",
      paths: fakePaths,
      skillMode: "no-skills",
      allowMissingCli: true,
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      prompt: async () => "y",
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: capture,
      agentSmithHome: workDir,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    // Positive-control: consent path MUST flip the gate to true.
    const map = getMap();
    expect(map?.get("approved-hook-check")).toBe(true);
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
