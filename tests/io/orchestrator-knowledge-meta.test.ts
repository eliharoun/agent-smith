// tests/io/orchestrator-knowledge-meta.test.ts
//
// Regression coverage for the install/render path writing per-source
// `.meta.json` refresh-cache entries. Prior behavior: only
// `_manifest.json` was written during install; the GUI then showed
// "never refreshed" for every source until something else (knowledge
// fetch / refresh-session / daemon) ran. The orchestrator now writes
// meta for each rendered source so the GUI loop closes on first
// install.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import type { InstallPaths } from "../../src/core/types";
import { buildAndInstall } from "../../src/io/orchestrator";
import { fakeBundle } from "../_helpers/fakeBundle";

describe("buildAndInstall writes per-source refresh-cache meta", () => {
  let bundleDir: string;
  let opencodeAgentsDir: string;
  let claudeAgentsDir: string;
  let codexAgentsDir: string;
  let kiroAgentsDir: string;
  let agentSmithHome: string;
  let cacheRoot: string;
  let paths: InstallPaths;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-meta-bundle-"));
    opencodeAgentsDir = await mkdtemp(join(tmpdir(), "smith-meta-oc-"));
    claudeAgentsDir = await mkdtemp(join(tmpdir(), "smith-meta-cc-"));
    codexAgentsDir = await mkdtemp(join(tmpdir(), "smith-meta-cx-"));
    kiroAgentsDir = await mkdtemp(join(tmpdir(), "smith-meta-kiro-"));
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-meta-home-"));
    cacheRoot = await mkdtemp(join(tmpdir(), "smith-meta-cache-"));
    paths = {
      opencode: opencodeAgentsDir,
      "claude-code": claudeAgentsDir,
      codex: codexAgentsDir,
      kiro: kiroAgentsDir,
      "agents-md": join(agentSmithHome, "agents-md"),
    };
    await writeFile(join(bundleDir, "schema.sql"), "select 1;");
    await writeFile(join(bundleDir, "notes.md"), "# Notes\nSome content.");
  });

  afterEach(async () => {
    for (const d of [
      bundleDir,
      opencodeAgentsDir,
      claudeAgentsDir,
      codexAgentsDir,
      kiroAgentsDir,
      agentSmithHome,
      cacheRoot,
    ]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  const modelResolutionEnv: ModelResolutionEnv = {
    getOpenCodeModels: async () => undefined,
    warnings: { push() {} },
    detectAuthenticatedProviders: async () => ["github-copilot"],
  };

  it("writes .meta.json for each rendered source after a successful install", async () => {
    const bundle = fakeBundle("meta-test", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    bundle.config.knowledge = {
      sources: [
        {
          id: "schema",
          type: "file",
          path: "./schema.sql",
          delivery: "inline",
          description: "DB schema",
        },
        {
          id: "notes",
          type: "file",
          path: "./notes.md",
          delivery: "inline",
          description: "Project notes",
        },
      ],
    };

    const before = Date.now();
    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      cacheRoot,
      homeDir: agentSmithHome,
    });
    const after = Date.now();

    expect(result.errors).toEqual([]);

    // Regression guard: _manifest.json still written (pre-existing behavior).
    const manifestPath = join(agentSmithHome, "knowledge", "meta-test", "_manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.sources.map((s: { id: string }) => s.id).sort()).toEqual(["notes", "schema"]);

    // New behavior: per-source .meta.json files exist under cacheRoot.
    for (const sourceId of ["schema", "notes"]) {
      const metaPath = join(cacheRoot, "agents", "meta-test", "sources", `${sourceId}.meta.json`);
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      expect(meta.last_error).toBeNull();
      const ts = Date.parse(meta.last_refreshed_at);
      expect(Number.isNaN(ts)).toBe(false);
      // Timestamp was minted during this test invocation.
      expect(ts).toBeGreaterThanOrEqual(before - 1);
      expect(ts).toBeLessThanOrEqual(after + 1);
      expect(meta.last_attempt_at).toBe(meta.last_refreshed_at);
    }
  });

  it("does not write .meta.json when there are no knowledge sources", async () => {
    const bundle = fakeBundle("no-knowledge", {
      bundlePath: bundleDir,
      targets: ["opencode"],
    });
    // No knowledge block at all — orchestrator must not touch cacheRoot.

    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv,
      knowledgePaths: { agentSmithHome },
      cacheRoot,
      homeDir: agentSmithHome,
    });

    expect(result.errors).toEqual([]);
    // cacheRoot/agents/no-knowledge should not exist.
    let exists = false;
    try {
      await readFile(join(cacheRoot, "agents", "no-knowledge", "sources", "anything"));
      exists = true;
    } catch {
      // ENOENT expected
    }
    expect(exists).toBe(false);
  });
});
