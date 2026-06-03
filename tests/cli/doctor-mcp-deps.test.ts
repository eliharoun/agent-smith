/**
 * End-to-end CLI coverage for `smith doctor`'s mcp-deps section.
 *
 * Drives runDoctorCli with the explicit `mcpDeps` DI seam so the section
 * runs entirely against in-memory stubs — no real `~/.claude.json`, no
 * real bundle registry, no real homedir read. This isolation is
 * load-bearing: without the DI seam the production wiring would call
 * `readAvailableMcpServers({ homeDir: homedir() })` and `loadAllBundles`
 * against the developer's actual environment.
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
  // Empty placeholder paths so mcpSpawn DI doesn't hit the developer's
  // real ~/.claude.json. The mcp-spawn-commands section runs against
  // these (empty) configs, which is fine — we only assert on mcpDeps.
  opencodeConfig: string;
  claudeMcpConfig: string;
  codexConfig: string;
  kiroMcpConfig: string;
  schemaCachePath: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-mcp-deps-"));
  ctx = {
    root,
    opencodeConfig: join(root, "opencode", "opencode.json"),
    claudeMcpConfig: join(root, ".claude.json"),
    codexConfig: join(root, "codex", "config.toml"),
    kiroMcpConfig: join(root, "kiro", "settings", "mcp.json"),
    schemaCachePath: join(root, "schema-cache.json"),
  };
  // Write empty configs so the mcp-spawn-commands section has nothing to
  // flag and never falls back to a real homedir path.
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
    // The mcp-spawn-commands section reads from these tmpdir-only paths,
    // never from the real homedir.
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

describe("runDoctorCli mcp-deps section", () => {
  test("emits an error finding when an installed agent's required MCP is missing", async () => {
    const sink = { value: "" };
    const exit = await runDoctorCli({
      ...baseOpts(sink),
      mcpDeps: {
        readAvailable: async () => ({}),
        loadInstalledAgents: async () => [
          { name: "test-agent", mcp: { required: ["missing"] } },
        ],
      },
    });
    expect(exit).toBe(0); // mcp-deps is informational; never bumps exit code.
    const report = JSON.parse(sink.value.trim());
    expect(report.mcpDeps).toBeDefined();
    expect(report.mcpDeps.findings).toHaveLength(1);
    expect(report.mcpDeps.findings[0]).toEqual({
      agent: "test-agent",
      server: "missing",
      kind: "required",
      severity: "error",
    });
  });

  test("emits a warning finding for missing peer", async () => {
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      mcpDeps: {
        readAvailable: async () => ({}),
        loadInstalledAgents: async () => [
          { name: "test-agent", mcp: { peer: ["optional"] } },
        ],
      },
    });
    const report = JSON.parse(sink.value.trim());
    expect(report.mcpDeps.findings).toHaveLength(1);
    expect(report.mcpDeps.findings[0]).toEqual({
      agent: "test-agent",
      server: "optional",
      kind: "peer",
      severity: "warning",
    });
  });

  test("no findings when every required and peer is configured", async () => {
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      mcpDeps: {
        readAvailable: async () => ({
          internal: { command: "/abs/internal" },
          atlassian: { command: "/abs/atlassian" },
        }),
        loadInstalledAgents: async () => [
          { name: "agent-a", mcp: { required: ["internal"], peer: ["atlassian"] } },
        ],
      },
    });
    const report = JSON.parse(sink.value.trim());
    expect(report.mcpDeps).toBeDefined();
    expect(report.mcpDeps.findings).toEqual([]);
  });

  test("multi-agent: one finding per (agent, server) pair, deterministic order", async () => {
    const sink = { value: "" };
    await runDoctorCli({
      ...baseOpts(sink),
      mcpDeps: {
        readAvailable: async () => ({}),
        loadInstalledAgents: async () => [
          { name: "agent-a", mcp: { required: ["x", "y"] } },
          { name: "agent-b", mcp: { required: ["x"] } },
        ],
      },
    });
    const report = JSON.parse(sink.value.trim());
    expect(report.mcpDeps.findings).toHaveLength(3);
    expect(
      report.mcpDeps.findings.map((f: { agent: string; server: string }) => `${f.agent}:${f.server}`),
    ).toEqual(["agent-a:x", "agent-a:y", "agent-b:x"]);
  });
});
