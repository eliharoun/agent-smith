/**
 * End-to-end CLI coverage for `smith doctor`'s lazy-fetch section.
 *
 * Drives runDoctorCli with the explicit `lazyFetch` DI seam so the section
 * runs entirely against in-memory stubs — no real `~/.claude.json`, no
 * real bundle registry, no real homedir read. Mirrors the
 * `doctor-mcp-deps.test.ts` shape: assert against the JSON report rather
 * than stderr because lazy-fetch is informational and never flips
 * `report.exitCode`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { runDoctorCli } from "../../src/cli/commands/doctor";
import type { PlatformId } from "../../src/io/platform-detect";

const allPlatforms = async (): Promise<Set<PlatformId>> =>
  new Set<PlatformId>(["opencode", "claude-code", "codex", "kiro"]);

interface Ctx {
  root: string;
  opencodeConfig: string;
  claudeMcpConfig: string;
  codexConfig: string;
  kiroMcpConfig: string;
  schemaCachePath: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-lazy-fetch-"));
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
  } as const;
}

describe("runDoctorCli lazy-fetch section", () => {
  test("flags a lazy URL source on a target with no fetch tool", async () => {
    const sink = { value: "" };
    const exit = await runDoctorCli({
      ...baseOpts(sink),
      lazyFetch: {
        loadBundles: async () => [
          {
            name: "test-agent",
            targets: ["codex"], // codex has no webfetch tool mapped
            sources: [
              {
                id: "wiki",
                type: "url",
                url: "https://example.com",
                lazy: true,
                description: "A wiki",
              },
            ],
          },
        ],
        readAvailable: async () => ({}),
      },
    });
    // lazy-fetch is informational; it never flips the exit code.
    expect(exit).toBe(0);
    const report = JSON.parse(sink.value.trim());
    expect(report.lazyFetch).toBeDefined();
    expect(report.lazyFetch.findings).toHaveLength(1);
    expect(report.lazyFetch.findings[0]).toMatchObject({
      agent: "test-agent",
      sourceId: "wiki",
      severity: "error",
    });
    expect(report.lazyFetch.findings[0].message).toMatch(/wiki|fetch/i);
  });
});
