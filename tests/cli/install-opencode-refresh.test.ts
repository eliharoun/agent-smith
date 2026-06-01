import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import { readRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
import { readOpencodePluginSentinel } from "../../src/io/opencode-plugin";
import type { OrchestratorResult } from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";
import { removeBundle } from "../../src/io/uninstaller";
import { fakeBundle } from "../_helpers/fakeBundle";

/**
 * Phase-5 integration test. Mirrors install-codex-refresh.test.ts but
 * substitutes opencode-specific assertions: instead of
 * <codexHome>/hooks.json we read
 * <opencodeHome>/plugins/agent-smith-refresh/.smith-managed.
 *
 * Fixture builder is inlined (rather than extracted from phase-3) because
 * the phase-3 helper is a tiny private function tightly coupled to its
 * file's other test wiring; duplicating two lines is cheaper than
 * refactoring two test files for marginal DRY gain.
 */

const emptyResult: OrchestratorResult = {
  installed: [],
  skipped: [],
  warnings: [],
  errors: [],
  grantedKnowledgeDirs: [],
  knowledge: [],
};

function bundleWithSessionSource(name: string): AgentBundle {
  const b = fakeBundle(name, { targets: ["opencode"] });
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

describe("install opencode refresh consent", () => {
  let agentHome: string;
  let opencodeHome: string;
  beforeEach(async () => {
    agentHome = await mkdtemp(join(tmpdir(), "install-opencode-agent-"));
    opencodeHome = await mkdtemp(join(tmpdir(), "install-opencode-home-"));
  });
  afterEach(async () => {
    await rm(agentHome, { recursive: true, force: true });
    await rm(opencodeHome, { recursive: true, force: true });
  });

  test("--refresh-consent yes registers agent in plugin sentinel and writes manifest", async () => {
    const exit = await install({
      name: "opencode-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "yes" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("opencode-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: agentHome,
      opencodeConfigHome: opencodeHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);

    const sentinel = await readOpencodePluginSentinel(opencodeHome);
    expect(sentinel?.agents).toContain("opencode-agent");

    const manifest = await readRefreshManifest(agentHome, "opencode-agent");
    expect(manifest?.refresh_consent.platforms).toContain("opencode");
    expect(manifest?.refresh_consent.sources).toContain("live-docs");
  });

  test("--refresh-consent no does NOT register agent in plugin", async () => {
    const exit = await install({
      name: "opencode-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "no" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("opencode-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: agentHome,
      opencodeConfigHome: opencodeHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);

    // Plugin dir must NOT exist (consent gating mirrors codex).
    expect(await readOpencodePluginSentinel(opencodeHome)).toBeUndefined();
    // And manifest must not record opencode consent.
    const manifest = await readRefreshManifest(agentHome, "opencode-agent");
    expect(manifest).toBeUndefined();
  });

  test("uninstall removes agent from plugin sentinel; tears down plugin when last agent", async () => {
    // Install first.
    const exit = await install({
      name: "opencode-agent",
      paths: fakePaths,
      skillMode: "no-skills",
      refreshConsent: { kind: "scalar", value: "yes" },
      loadRegistry: async () => fakeRegistry,
      loadAllBundles: async () => ({
        bundles: [bundleWithSessionSource("opencode-agent")],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      agentSmithHome: agentHome,
      opencodeConfigHome: opencodeHome,
      print: () => {},
      printErr: () => {},
    });
    expect(exit).toBe(0);
    // Sanity: sentinel installed.
    expect((await readOpencodePluginSentinel(opencodeHome))?.agents).toContain("opencode-agent");

    // Stage a real opencode-target install file so removeBundle has
    // something concrete to remove (matches install layout:
    // <opencode>/<agent>.md). Mirrors the staging pattern in
    // tests/io/uninstaller-refresh-hooks.test.ts.
    const installPaths: InstallPaths = {
      opencode: join(agentHome, "opencode-agents"),
      "claude-code": join(agentHome, "claude-agents"),
      codex: join(agentHome, "codex-skills"),
      kiro: join(agentHome, "kiro-skills"),
      "agents-md": join(agentHome, "agents-md")
    };
    await mkdir(installPaths.opencode, { recursive: true });
    await writeFile(join(installPaths.opencode, "opencode-agent.md"), "x");

    const bundle = bundleWithSessionSource("opencode-agent");
    const result = await removeBundle(
      bundle,
      installPaths,
      { agentSmithHome: agentHome },
      { opencodeConfigHome: opencodeHome },
    );

    expect(result.errors).toEqual([]);
    // Last (and only) agent removed ⇒ plugin dir + sentinel torn down.
    expect(await readOpencodePluginSentinel(opencodeHome)).toBeUndefined();
  });

  test("uninstall keeps plugin alive when other agents still consent", async () => {
    // Drive both agents through the real install() pipeline (not direct
    // registerAgentInOpencodePlugin calls) so regressions in the
    // second-install path actually fail this test.
    async function installOne(name: string): Promise<void> {
      const exit = await install({
        name,
        paths: fakePaths,
        skillMode: "no-skills",
        refreshConsent: { kind: "scalar", value: "yes" },
        loadRegistry: async () => fakeRegistry,
        loadAllBundles: async () => ({
          bundles: [bundleWithSessionSource(name)],
          failures: [],
        }),
        buildAndInstall: async () => emptyResult,
        agentSmithHome: agentHome,
        opencodeConfigHome: opencodeHome,
        print: () => {},
        printErr: () => {},
      });
      expect(exit).toBe(0);
    }

    await installOne("agent-a");
    await installOne("agent-b");

    // Sentinel must contain both agents (order-independent).
    const seeded = await readOpencodePluginSentinel(opencodeHome);
    expect(seeded?.agents?.slice().sort()).toEqual(["agent-a", "agent-b"]);

    // Stage the install file for agent-a so removeBundle can proceed
    // (buildAndInstall is faked, so no real opencode/<agent>.md exists).
    const installPaths: InstallPaths = {
      opencode: join(agentHome, "opencode-agents"),
      "claude-code": join(agentHome, "claude-agents"),
      codex: join(agentHome, "codex-skills"),
      kiro: join(agentHome, "kiro-skills"),
      "agents-md": join(agentHome, "agents-md")
    };
    await mkdir(installPaths.opencode, { recursive: true });
    await writeFile(join(installPaths.opencode, "agent-a.md"), "x");

    const bundle = fakeBundle("agent-a", { targets: ["opencode"] });
    const result = await removeBundle(
      bundle,
      installPaths,
      { agentSmithHome: agentHome },
      { opencodeConfigHome: opencodeHome },
    );

    expect(result.errors).toEqual([]);

    // Plugin must NOT be torn down — agent-b still consents.
    const sentinel = await readOpencodePluginSentinel(opencodeHome);
    expect(sentinel).toBeDefined();
    expect(sentinel?.agents).toEqual(["agent-b"]);

    // Plugin entry file and opencode.json registration must persist too.
    const { stat, readFile } = await import("node:fs/promises");
    await expect(
      stat(join(opencodeHome, "plugins/agent-smith-refresh/index.ts")),
    ).resolves.toBeDefined();
    const opencodeJson = JSON.parse(await readFile(join(opencodeHome, "opencode.json"), "utf8"));
    expect(opencodeJson.plugin).toContain("./plugins/agent-smith-refresh");
  });
});
