// tests/cli/install-lazy-e2e.test.ts
//
// End-to-end coverage for installing a bundle that declares a single lazy
// URL knowledge source. Drives the full CLI `install()` entry point —
// registry load, bundle filter, MCP preflight, real `buildAndInstall`,
// post-install summary — but injects a fake fetcher so no network is
// touched. Lower-level orchestrator coverage lives in
// `tests/io/orchestrator-lazy-agents-md.test.ts`; this file proves the CLI
// plumbing renders the expected outputs for both target families:
//   - claude-code: lazy TOC entry + URL + fetch hint, NOT the body.
//   - agents-md:   body + `> source: <url>` ref appended.
//
// The test never reads the real $HOME: every state path (agentSmithHome,
// install paths, cacheRoot, knowledgePaths) is a mkdtemp dir torn down in
// afterEach, and the route-cache loader is stubbed.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
import {
  type BuildAndInstallOptions,
  buildAndInstall as realBuildAndInstall,
} from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";

const HEAVY_TIMEOUT = 30_000;

describe("install: lazy URL sources end-to-end", () => {
  let home: string;
  let bundleDir: string;
  let agentSmithHome: string;
  let cacheRoot: string;
  let opencodeDir: string;
  let claudeDir: string;
  let codexDir: string;
  let kiroDir: string;
  let agentsMdDir: string;
  let paths: InstallPaths;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "lazy-e2e-"));
    bundleDir = join(home, "bundle");
    await mkdir(bundleDir, { recursive: true });
    agentSmithHome = await mkdtemp(join(tmpdir(), "lazy-e2e-home-"));
    cacheRoot = await mkdtemp(join(tmpdir(), "lazy-e2e-cache-"));
    opencodeDir = await mkdtemp(join(tmpdir(), "lazy-e2e-oc-"));
    claudeDir = await mkdtemp(join(tmpdir(), "lazy-e2e-cc-"));
    codexDir = await mkdtemp(join(tmpdir(), "lazy-e2e-cx-"));
    kiroDir = await mkdtemp(join(tmpdir(), "lazy-e2e-kiro-"));
    agentsMdDir = await mkdtemp(join(tmpdir(), "lazy-e2e-am-"));
    paths = {
      opencode: opencodeDir,
      "claude-code": claudeDir,
      codex: codexDir,
      kiro: kiroDir,
      "agents-md": agentsMdDir,
    };
  });

  afterEach(async () => {
    for (const d of [
      home,
      agentSmithHome,
      cacheRoot,
      opencodeDir,
      claudeDir,
      codexDir,
      kiroDir,
      agentsMdDir,
    ]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  // Inject a deterministic model-resolution env so the install never tries
  // to spawn `opencode` or probe live providers. `allowMissingCli: true`
  // ensures the resolver emits a static tier literal instead of throwing
  // PlatformUnavailableError when the platform CLI is absent (CI / clean env).
  const modelResolutionEnv: ModelResolutionEnv = {
    getOpenCodeModels: async () => undefined,
    warnings: { push() {} },
    detectAuthenticatedProviders: async () => ["github-copilot"],
    allowMissingCli: true,
  };

  it(
    "renders lazy TOC for claude-code and degraded body for agents-md",
    async () => {
      const fakeUrl = "https://wiki.example.test/architecture";
      const fakeBody = "# Architecture\n\nReal content of the wiki page.";
      const fetchCalls: string[] = [];
      const fetchFn = async (url: string) => {
        fetchCalls.push(url);
        return fakeBody;
      };

      // A minimal in-memory bundle whose canonical config declares one
      // lazy URL source and targets both claude-code AND agents-md. Opting
      // out of `deferToAgentsMd` makes the claude-code body carry its own
      // assembled content (incl. the lazy TOC entry); without this flag the
      // claude-code translator emits a thin pointer to AGENTS.md.
      const bundle: AgentBundle = {
        config: {
          schemaVersion: 1,
          name: "test-agent",
          description: "Test bundle for lazy URL e2e.",
          targets: ["claude-code", "agents-md"],
          modelTier: "balanced",
          targetOptions: {
            claudeCode: { deferToAgentsMd: false },
          },
          knowledge: {
            sources: [
              {
                id: "wiki",
                type: "webpage",
                url: fakeUrl,
                lazy: true,
                description:
                  "Architecture wiki. Use when answering deployment topology questions.",
              },
            ],
            // Force the v2 progressive compile stanza so the claude-code body
            // carries the lazy TOC entry. Without this, a lazy-only bundle
            // has totals.bytes = 0 and skips the auto-compile threshold.
            compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
          },
        },
        source: { kind: "user-global", rootPath: home, label: "user-global" },
        bundlePath: bundleDir,
        files: {
          identity: "# Identity\nTest agent.",
          expertise: "# Expertise\nTesting.",
          soul: "# Soul\nDeliberate.",
          user: "# User\nTester.",
        },
      };

      // Wrap the real orchestrator so we can inject `fetchFn` (the CLI
      // `install()` API does not expose it directly — it threads its own
      // options through). Also pin every state path to a tmpdir so nothing
      // reads or writes $HOME.
      const wrappedBuildAndInstall = (
        bundles: AgentBundle[],
        installPaths: InstallPaths,
        options?: BuildAndInstallOptions,
      ) =>
        realBuildAndInstall(bundles, installPaths, {
          ...(options ?? {}),
          modelResolutionEnv,
          knowledgePaths: { agentSmithHome },
          cacheRoot,
          homeDir: agentSmithHome,
          fetchFn,
        });

      const exit = await install({
        name: "test-agent",
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
        buildAndInstall: wrappedBuildAndInstall,
        readAvailableMcpServers: async () => ({}),
        loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
        saveRouteCache: async () => {},
        skillMode: "no-skills",
        noRefreshHooks: true,
        allowMissingCli: true,
        detectInstalledPlatforms: async () =>
          new Set(["opencode", "claude-code", "codex", "kiro"] as const),
        agentSmithHome,
        print: () => {},
        printErr: () => {},
      });

      expect(exit).toBe(0);

      // The lazy URL should NOT have been fetched for claude-code, but
      // agents-md degrade pass DOES fetch and inline the body.
      expect(fetchCalls).toEqual([fakeUrl]);

      // claude-code render: lazy TOC entry, URL, fetch hint — not the body.
      const ccOut = await readFile(
        join(claudeDir, "test-agent.md"),
        "utf8",
      );
      expect(ccOut).toMatch(/`wiki` \[webpage, lazy\]/);
      expect(ccOut).toContain(fakeUrl);
      expect(ccOut).toMatch(/fetch via:/i);
      expect(ccOut).not.toContain("Real content of the wiki page");

      // agents-md render: fetched body + > source: ref.
      const amOut = await readFile(join(agentsMdDir, "AGENTS.md"), "utf8");
      expect(amOut).toContain("Real content of the wiki page");
      expect(amOut).toContain(`> source: ${fakeUrl}`);
    },
    HEAVY_TIMEOUT,
  );
});
