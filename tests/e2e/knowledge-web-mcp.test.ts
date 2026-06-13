/**
 * E2E: knowledge source types — web, mcp, and legacy url→webpage normalization.
 *
 * Coverage:
 *   (a) Legacy `type: url` validates and normalizes to `type: webpage` via parseConfig.
 *       Also verifies collectKnowledgeDeprecations surfaces a deprecation warning.
 *   (b) `type: mcp` source materialized through the echo MCP server fixture produces
 *       a knowledge artifact.
 *   (c) `type: web` source validates and is accepted by parseConfig. Full acquire is
 *       NOT tested here (requires real network); unit tests in acquire-web.test.ts cover that.
 *
 * All tests are offline/deterministic — no real network calls.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectKnowledgeDeprecations, parseConfig } from "../../src/core/config-schema";
import { runKnowledgeStage } from "../../src/core/knowledge/pipeline";
import { McpClientPool } from "../../src/io/mcp-client-pool";

const here = dirname(fileURLToPath(import.meta.url));
const ECHO_FIXTURE = join(here, "../_fixtures/echo-mcp-server.ts");

describe("e2e: knowledge web + mcp + legacy-url sources", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "smith-e2e-web-mcp-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── (a) Legacy type:url → webpage normalization ───────────────────────

  it("legacy type:url normalizes to type:webpage and surfaces deprecation warning", () => {
    const raw = {
      name: "test-agent",
      description: "Builds a test agent for validation",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [{ id: "legacy-page", type: "url", url: "https://example.com/docs", lazy: true }],
      },
    };

    // collectKnowledgeDeprecations should find the deprecated type:url
    const deprecations = collectKnowledgeDeprecations(raw);
    expect(deprecations.length).toBe(1);
    expect(deprecations[0]).toContain("legacy-page");
    expect(deprecations[0]).toContain("type: url");
    expect(deprecations[0]).toContain("deprecated");

    // parseConfig should normalize url→webpage and succeed
    const result = parseConfig(raw);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unexpected parse failure");

    const sources = result.data.knowledge?.sources;
    expect(sources).toBeDefined();
    const src = sources?.[0];
    expect(src?.type).toBe("webpage");
    expect((src as { url?: string }).url).toBe("https://example.com/docs");
  });

  // ─── (b) type:mcp source via echo server ──────────────────────────────

  it("type:mcp source materializes through echo MCP server", async () => {
    const bundleDir = join(tmpDir, "bundle");
    const knowledgeDir = join(tmpDir, "knowledge");
    const cacheDir = join(tmpDir, "cache");
    await mkdir(bundleDir, { recursive: true });

    const pool = new McpClientPool();
    try {
      const result = await runKnowledgeStage(
        {
          sources: [
            {
              id: "echo-source",
              type: "mcp",
              server: "echo",
              tool: "Fetch",
              args: { url: "https://test.example.com/data" },
              delivery: "file",
            },
          ],
        },
        { bundleDir, knowledgeDir, cacheDir },
        {
          mcpPool: pool,
          spawnOptsFor: (server: string) => {
            if (server === "echo") return { command: "bun", args: [ECHO_FIXTURE] };
            throw new Error(`unknown server: ${server}`);
          },
        },
      );

      expect(result.errors).toEqual([]);
      // Manifest should record the mcp source
      expect(result.manifest.sources.length).toBe(1);
      expect(result.manifest.sources[0]?.id).toBe("echo-source");
      expect(result.manifest.sources[0]?.type).toBe("mcp");

      // A file should have been materialized in the knowledge dir
      const sourcesDir = join(knowledgeDir, "sources", "echo-source");
      const files = await readdir(sourcesDir);
      expect(files.length).toBeGreaterThan(0);
      // The echo server echoes the args back as JSON
      const firstFile = files[0] ?? "";
      expect(firstFile).not.toBe("");
      const content = await readFile(join(sourcesDir, firstFile), "utf8");
      expect(content).toContain("test.example.com");
    } finally {
      await pool.shutdown();
    }
  }, 15_000);

  // ─── (c) type:web validates in parseConfig (no network) ───────────────

  it("type:web source validates and is accepted by parseConfig", () => {
    const raw = {
      name: "web-agent",
      description: "Builds a web crawl knowledge agent",
      targets: ["opencode"],
      modelTier: "balanced",
      knowledge: {
        sources: [
          {
            id: "web-crawl",
            type: "web",
            url: "https://docs.example.com",
            mode: "crawl",
            delivery: "file",
            maxPages: 10,
            depth: 2,
          },
        ],
      },
    };

    const result = parseConfig(raw);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(`unexpected: ${result.errors.join(", ")}`);

    const sources = result.data.knowledge?.sources;
    expect(sources).toBeDefined();
    const src = sources?.[0];
    expect(src?.type).toBe("web");
    expect((src as { url?: string }).url).toBe("https://docs.example.com");
    expect((src as { mode?: string }).mode).toBe("crawl");
    // web source type is fully accepted without network — no acquire needed
    // (unit tests in tests/core/knowledge/acquire-web.test.ts cover the fetcher)
  });
});
