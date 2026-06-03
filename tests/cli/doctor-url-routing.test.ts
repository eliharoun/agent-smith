/**
 * End-to-end CLI coverage for `smith doctor`'s url-routing section.
 *
 * Drives runDoctorCli with the explicit `urlRouting` DI seam so the section
 * runs entirely against in-memory stubs — no real
 * `~/.config/agent-smith/url-routing.json`, no real MCP child processes,
 * no real bundle registry. This isolation is load-bearing: without the DI
 * seam the production wiring would call `loadRouteCache({ stateHome:
 * stateHome() })` and spawn each available MCP server, both of which
 * touch the developer's actual environment.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import { EMPTY_CACHE } from "../../src/core/knowledge/route-cache";
import type { PlatformId } from "../../src/io/platform-detect";

const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);

interface Ctx {
  root: string;
  // Empty placeholder paths so mcpSpawn DI doesn't hit the developer's
  // real ~/.claude.json. The mcp-spawn-commands section runs against
  // these (empty) configs, which is fine — we only assert on urlRouting.
  opencodeConfig: string;
  claudeMcpConfig: string;
  codexConfig: string;
  kiroMcpConfig: string;
  schemaCachePath: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-url-routing-"));
  ctx = {
    root,
    opencodeConfig: join(root, "opencode", "opencode.json"),
    claudeMcpConfig: join(root, ".claude.json"),
    codexConfig: join(root, "codex", "config.toml"),
    kiroMcpConfig: join(root, "kiro", "settings", "mcp.json"),
    schemaCachePath: join(root, "schema-cache.json"),
  };
  await mkdir(join(root, "opencode"), { recursive: true });
  await mkdir(join(root, "codex"), { recursive: true });
  await mkdir(join(root, "kiro", "settings"), { recursive: true });
  await writeFile(ctx.opencodeConfig, "{}", "utf8");
  await writeFile(ctx.claudeMcpConfig, "{}", "utf8");
  await writeFile(ctx.codexConfig, stringifyToml({}), "utf8");
  await writeFile(ctx.kiroMcpConfig, "{}", "utf8");
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

function baseOpts(stdoutSink: { value: string }) {
  return {
    detectInstalledPlatforms: allPlatforms,
    offline: true,
    noCache: false,
    json: true,
    skipModelResolution: true,
    cachePath: ctx.schemaCachePath,
    print: (s: string) => {
      stdoutSink.value += `${s}\n`;
    },
    mcpSpawn: {
      paths: {
        opencodeConfig: ctx.opencodeConfig,
        claudeMcpConfig: ctx.claudeMcpConfig,
        codexConfig: ctx.codexConfig,
        kiroMcpConfig: ctx.kiroMcpConfig,
      },
      resolveSmithPath: () => "/abs/path/to/smith",
      which: () => null,
    },
    // Bypass real mcp-deps wiring so the section never touches
    // ~/.claude.json. Empty stubs are fine — we only assert on urlRouting.
    mcpDeps: {
      readAvailable: async () => ({}),
      loadInstalledAgents: async () => [],
    },
  } as const;
}

describe("runDoctorCli url-routing section", () => {
  test("emits the merged routing table with curated entries when DI seam returns empty", async () => {
    const sink = { value: "" };
    const exit = await runDoctorCli({
      ...baseOpts(sink),
      urlRouting: {
        loadCache: async () => EMPTY_CACHE,
        listMetaClaims: async () => [],
      },
    });
    // url-routing is informational; never bumps the exit code.
    expect(exit).toBe(0);
    const report = JSON.parse(sink.value.trim());
    expect(report.urlRouting).toBeDefined();
    expect(Array.isArray(report.urlRouting.entries)).toBe(true);
    // Curated patterns are baked into the smith binary so the table
    // always carries at least one curated entry, even with empty inputs.
    expect(report.urlRouting.entries.length).toBeGreaterThan(0);
    expect(
      report.urlRouting.entries.every((e: { source: string }) => e.source === "curated"),
    ).toBe(true);
    expect(report.urlRouting.ambiguities).toEqual([]);
  });

  test("includes _meta and cache entries when the DI seam supplies them", async () => {
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      urlRouting: {
        loadCache: async () => ({
          schemaVersion: 1,
          entries: [
            {
              urlPattern: "https://learned.test/**",
              server: "cached-mcp",
              tool: "fetch_page",
              learnedAt: "2026-06-02T00:00:00.000Z",
              hits: 1,
            },
          ],
        }),
        listMetaClaims: async () => [
          {
            server: "advertised-mcp",
            tool: "read_doc",
            urlPatterns: ["https://advertised.test/**"],
          },
        ],
      },
    });
    const report = JSON.parse(sink.value.trim());
    const sources = report.urlRouting.entries.map((e: { source: string }) => e.source);
    expect(sources).toContain("_meta");
    expect(sources).toContain("cache");
    const cacheEntry = report.urlRouting.entries.find(
      (e: { source: string; urlPattern: string }) =>
        e.source === "cache" && e.urlPattern === "https://learned.test/**",
    );
    expect(cacheEntry).toEqual({
      urlPattern: "https://learned.test/**",
      source: "cache",
      server: "cached-mcp",
      tool: "fetch_page",
    });
    const metaEntry = report.urlRouting.entries.find(
      (e: { source: string; urlPattern: string }) =>
        e.source === "_meta" && e.urlPattern === "https://advertised.test/**",
    );
    expect(metaEntry).toEqual({
      urlPattern: "https://advertised.test/**",
      source: "_meta",
      server: "advertised-mcp",
      tool: "read_doc",
    });
  });

  test("flags an ambiguity when two sources claim the same pattern", async () => {
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      urlRouting: {
        loadCache: async () => ({
          schemaVersion: 1,
          entries: [
            {
              urlPattern: "https://shared.test/**",
              server: "cached-mcp",
              tool: "fetch_page",
              learnedAt: "2026-06-02T00:00:00.000Z",
              hits: 1,
            },
          ],
        }),
        listMetaClaims: async () => [
          {
            server: "advertised-mcp",
            tool: "read_doc",
            urlPatterns: ["https://shared.test/**"],
          },
        ],
      },
    });
    const report = JSON.parse(sink.value.trim());
    expect(report.urlRouting.ambiguities).toHaveLength(1);
    expect(report.urlRouting.ambiguities[0].urlPattern).toBe("https://shared.test/**");
    expect(report.urlRouting.ambiguities[0].claimants.length).toBe(2);
  });

  test("DI seam is not the real cache loader: real ~/.config is never read", async () => {
    // Sentinel: the DI factory must be called instead of the production
    // default. We assert the seam is invoked (counter increments) and
    // the report content reflects only the stubbed values.
    let cacheCalls = 0;
    let metaCalls = 0;
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      urlRouting: {
        loadCache: async () => {
          cacheCalls++;
          return {
            schemaVersion: 1,
            entries: [
              {
                urlPattern: "https://stub.test/**",
                server: "stub-mcp",
                tool: "stub_fetch",
                learnedAt: "2026-06-02T00:00:00.000Z",
                hits: 0,
              },
            ],
          };
        },
        listMetaClaims: async () => {
          metaCalls++;
          return [];
        },
      },
    });
    expect(cacheCalls).toBe(1);
    expect(metaCalls).toBe(1);
    const report = JSON.parse(sink.value.trim());
    const cacheEntries = report.urlRouting.entries.filter(
      (e: { source: string }) => e.source === "cache",
    );
    expect(cacheEntries).toEqual([
      {
        urlPattern: "https://stub.test/**",
        source: "cache",
        server: "stub-mcp",
        tool: "stub_fetch",
      },
    ]);
  });
});
