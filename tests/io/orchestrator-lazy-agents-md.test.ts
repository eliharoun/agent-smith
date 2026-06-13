// tests/io/orchestrator-lazy-agents-md.test.ts
//
// Integration coverage for the agents-md lazy URL degrade pass: when a
// bundle targets `agents-md` AND has lazy URL sources, the orchestrator
// fetches them at install time and appends a synthesized "## Lazy URL
// Sources" section to the AGENTS.md output. Other targets (claude-code,
// etc.) still render the lazy TOC entry from the compile stanza but do
// NOT receive the materialized body.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import type { InstallPaths } from "../../src/core/types";
import { buildAndInstall } from "../../src/io/orchestrator";
import { fakeBundle } from "../_helpers/fakeBundle";

const HEAVY_TIMEOUT = 30_000;

describe("orchestrator: agents-md lazy section", () => {
  let bundleDir: string;
  let opencodeAgentsDir: string;
  let claudeAgentsDir: string;
  let codexAgentsDir: string;
  let kiroAgentsDir: string;
  let agentsMdDir: string;
  let agentSmithHome: string;
  let cacheRoot: string;
  let paths: InstallPaths;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-lazyam-bundle-"));
    opencodeAgentsDir = await mkdtemp(join(tmpdir(), "smith-lazyam-oc-"));
    claudeAgentsDir = await mkdtemp(join(tmpdir(), "smith-lazyam-cc-"));
    codexAgentsDir = await mkdtemp(join(tmpdir(), "smith-lazyam-cx-"));
    kiroAgentsDir = await mkdtemp(join(tmpdir(), "smith-lazyam-kiro-"));
    agentsMdDir = await mkdtemp(join(tmpdir(), "smith-lazyam-am-"));
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-lazyam-home-"));
    cacheRoot = await mkdtemp(join(tmpdir(), "smith-lazyam-cache-"));
    paths = {
      opencode: opencodeAgentsDir,
      "claude-code": claudeAgentsDir,
      codex: codexAgentsDir,
      kiro: kiroAgentsDir,
      "agents-md": agentsMdDir,
    };
  });

  afterEach(async () => {
    for (const d of [
      bundleDir,
      opencodeAgentsDir,
      claudeAgentsDir,
      codexAgentsDir,
      kiroAgentsDir,
      agentsMdDir,
      agentSmithHome,
      cacheRoot,
    ]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  // `allowMissingCli: true` ensures the resolver emits a static tier literal
  // instead of throwing PlatformUnavailableError when the platform CLI is
  // absent (CI / clean env). Required because the orchestrator merges
  // allowMissingCli into the fallback modelEnv only when no injected env is
  // provided — so tests that inject modelResolutionEnv must set it explicitly.
  const modelResolutionEnv: ModelResolutionEnv = {
    getOpenCodeModels: async () => undefined,
    warnings: { push() {} },
    detectAuthenticatedProviders: async () => ["github-copilot"],
    allowMissingCli: true,
  };

  it(
    "fetches lazy URL for agents-md target and appends to its body",
    async () => {
      const fakeUrl = "https://wiki.internal.example.com/architecture";
      const fakeBody = "# Architecture\n\nPlatform deploys to two regions.";
      const fetchCalls: string[] = [];
      const fetchFn = async (url: string) => {
        fetchCalls.push(url);
        return fakeBody;
      };

      const bundle = fakeBundle("test-agent", {
        bundlePath: bundleDir,
        targets: ["agents-md", "claude-code"],
      });
      // Opt out of the defer-to-AGENTS.md shortcut so the claude-code body
      // carries the full assembled content (including the lazy TOC entry)
      // and we can prove the orchestrator's per-target body split is wired.
      bundle.config.targetOptions = {
        claudeCode: { deferToAgentsMd: false },
      };
      bundle.config.knowledge = {
        sources: [
          {
            id: "wiki",
            type: "webpage",
            url: fakeUrl,
            lazy: true,
            description:
              "Architecture wiki. Use for deployment topology questions.",
          },
        ],
        // Force the v2 compile stanza so the claude-code body carries the
        // lazy TOC entry. Without this, a lazy-only bundle has totals.bytes
        // = 0 which doesn't trip the auto-compile threshold.
        compile: { progressive: true, tocMaxLines: 150, emitAgentsMd: false },
      };

      const result = await buildAndInstall([bundle], paths, {
        modelResolutionEnv,
        knowledgePaths: { agentSmithHome },
        cacheRoot,
        homeDir: agentSmithHome,
        fetchFn,
        allowMissingCli: true,
      });

      expect(result.errors).toEqual([]);
      expect(fetchCalls).toContain(fakeUrl);

      // agents-md output: contains the fetched body + > source: ref.
      const agentsMdOut = await readFile(
        join(agentsMdDir, "AGENTS.md"),
        "utf8",
      );
      expect(agentsMdOut).toContain("## Lazy URL Sources");
      expect(agentsMdOut).toContain("Platform deploys to two regions");
      expect(agentsMdOut).toContain(`> source: ${fakeUrl}`);

      // claude-code output: lazy TOC entry, NOT the body content.
      const ccOut = await readFile(
        join(claudeAgentsDir, "test-agent.md"),
        "utf8",
      );
      expect(ccOut).not.toContain("Platform deploys to two regions");
      expect(ccOut).toMatch(/`wiki` \[webpage, lazy\]/);
    },
    HEAVY_TIMEOUT,
  );
});
