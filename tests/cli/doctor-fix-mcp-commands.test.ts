/**
 * End-to-end CLI coverage for `smith doctor --fix-mcp-commands`.
 *
 * Drives runDoctorCli with injected MCP config paths so the audit + auto-
 * repair runs against a hermetic tmpdir. Assertions cover:
 *
 *   - Each platform's bare `"smith"` is rewritten to its absolute path.
 *   - Other entries (and other top-level keys) in the config are preserved.
 *   - Codex TOML round-trips correctly.
 *   - Idempotency: running fix twice produces identical bytes.
 *   - Unresolvable commands are skipped (config left alone, warning printed).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-fix-mcp-"));
  ctx = {
    root,
    opencodeConfig: join(root, "opencode", "opencode.json"),
    claudeMcpConfig: join(root, ".claude.json"),
    codexConfig: join(root, "codex", "config.toml"),
    kiroMcpConfig: join(root, "kiro", "settings", "mcp.json"),
    schemaCachePath: join(root, "schema-cache.json"),
  };
});

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true });
});

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

async function writeTomlFile(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, stringifyToml(data), "utf8");
}

async function readJson(path: string): Promise<any> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

async function readTomlFile(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, "utf8");
  return parseToml(text) as Record<string, unknown>;
}

const STUB_SMITH = "/abs/path/to/smith";

function commonOpts(stdoutSink: { value: string }) {
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
      resolveSmithPath: () => STUB_SMITH,
      which: (cmd: string) => (cmd === "smith" ? STUB_SMITH : null),
    },
  } as const;
}

describe("runDoctorCli --fix-mcp-commands", () => {
  test("rewrites bare \"smith\" across all four platforms; other entries preserved", async () => {
    // OpenCode (JSON, top-level `mcp` key)
    await writeJson(ctx.opencodeConfig, {
      mcp: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
        other: { command: "/usr/local/bin/other", args: ["x"] },
      },
      otherTopLevel: { keep: true },
    });
    // Claude Code (JSON, `mcpServers`)
    await writeJson(ctx.claudeMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
      },
      projects: { "/Users/x": { mcpServers: { local: { command: "/abs/local" } } } },
    });
    // Codex (TOML, `[mcp_servers.<name>]`)
    await writeTomlFile(ctx.codexConfig, {
      mcp_servers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
        other: { command: "/usr/bin/other" },
      },
    });
    // Kiro (JSON, `mcpServers`)
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
      },
    });

    const sink = { value: "" };
    await runDoctorCli({ ...commonOpts(sink), fixMcpCommands: true });

    // OpenCode rewritten
    const oc = await readJson(ctx.opencodeConfig);
    expect(oc.mcp["agent-smith-knowledge"].command).toBe(STUB_SMITH);
    expect(oc.mcp["agent-smith-knowledge"].args).toEqual([
      "knowledge",
      "serve",
      "alpha",
    ]);
    expect(oc.mcp.other.command).toBe("/usr/local/bin/other"); // untouched
    expect(oc.otherTopLevel).toEqual({ keep: true }); // unrelated top-level preserved

    // Claude Code rewritten
    const cc = await readJson(ctx.claudeMcpConfig);
    expect(cc.mcpServers["agent-smith-knowledge"].command).toBe(STUB_SMITH);
    expect(cc.projects["/Users/x"].mcpServers.local.command).toBe("/abs/local");

    // Codex rewritten (TOML round-trip)
    const cx = await readTomlFile(ctx.codexConfig);
    const cxServers = cx.mcp_servers as Record<string, { command: string }>;
    expect(cxServers["agent-smith-knowledge"]?.command).toBe(STUB_SMITH);
    expect(cxServers.other?.command).toBe("/usr/bin/other");

    // Kiro rewritten
    const kr = await readJson(ctx.kiroMcpConfig);
    expect(kr.mcpServers["agent-smith-knowledge"].command).toBe(STUB_SMITH);
  });

  test("idempotent: second --fix run produces identical bytes", async () => {
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "x"] },
      },
    });

    const sink1 = { value: "" };
    await runDoctorCli({ ...commonOpts(sink1), fixMcpCommands: true });
    const after1 = await readFile(ctx.kiroMcpConfig, "utf8");

    const sink2 = { value: "" };
    await runDoctorCli({ ...commonOpts(sink2), fixMcpCommands: true });
    const after2 = await readFile(ctx.kiroMcpConfig, "utf8");

    expect(after2).toBe(after1);
  });

  test("unresolvable command: config untouched, warning printed", async () => {
    await writeJson(ctx.opencodeConfig, {
      mcp: { ghost: { command: "definitely-not-installed-xyz", args: [] } },
    });
    const before = await readFile(ctx.opencodeConfig, "utf8");

    const sink = { value: "" };
    await runDoctorCli({
      ...commonOpts(sink),
      fixMcpCommands: true,
      // Override: no resolution for the ghost command.
      mcpSpawn: {
        paths: {
          opencodeConfig: ctx.opencodeConfig,
          claudeMcpConfig: ctx.claudeMcpConfig,
          codexConfig: ctx.codexConfig,
          kiroMcpConfig: ctx.kiroMcpConfig,
        },
        resolveSmithPath: () => STUB_SMITH,
        which: () => null,
      },
    });

    const after = await readFile(ctx.opencodeConfig, "utf8");
    expect(after).toBe(before);
    expect(sink.value).toMatch(/can't auto-fix.*definitely-not-installed-xyz/);
  });

  test("post-fix render: section re-runs and reports clean", async () => {
    // Bug 5 regression: prior to the post-fix re-run, the printed report
    // cached the pre-fix state, so users saw the fix succeed but still saw
    // the same fragile-spawn warning text. After the fix, the section is
    // re-checked and the human-mode summary shows ok.
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
      },
    });

    const sink = { value: "" };
    const code = await runDoctorCli({
      ...commonOpts(sink),
      json: false,
      fixMcpCommands: true,
    });

    expect(sink.value).toMatch(/✓ rewrote.*kiro\/agent-smith-knowledge/);
    // Post-fix the section is clean — no "fragile" warning text in the report.
    expect(sink.value).not.toMatch(/fragile entr/);
    // The compact summary line for the section says ok.
    expect(sink.value).toMatch(/MCP spawn commands: ok/);
    // mcp-spawn-commands does not contribute to exit code (informational).
    expect(code).toBe(0);
  });

  test("post-fix re-run: report.mcpSpawnCommands reflects clean state in JSON output", async () => {
    // Bug 5 regression for --json mode. Before the post-fix re-run, the
    // emitted JSON contained the pre-fix findings; downstream consumers
    // (CI scripts, GUIs) saw stale state.
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: ["knowledge", "serve", "alpha"] },
      },
    });

    const sink = { value: "" };
    await runDoctorCli({ ...commonOpts(sink), fixMcpCommands: true });

    // Slice past the repair-pass progress lines to find the JSON document.
    const trimmed = sink.value.trim();
    const lastBraceIdx = trimmed.lastIndexOf("\n{");
    const jsonText = lastBraceIdx >= 0 ? trimmed.slice(lastBraceIdx + 1) : trimmed;
    const report = JSON.parse(jsonText);
    expect(report.mcpSpawnCommands).toBeDefined();
    expect(report.mcpSpawnCommands.findings).toHaveLength(0);
    expect(report.mcpSpawnCommands.status).toBe("clean");
  });

  test("detection-only (no --fix): findings reported, configs unchanged", async () => {
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: [] },
      },
    });
    const before = await readFile(ctx.kiroMcpConfig, "utf8");

    const sink = { value: "" };
    await runDoctorCli({ ...commonOpts(sink) });

    const after = await readFile(ctx.kiroMcpConfig, "utf8");
    expect(after).toBe(before);
    // The JSON report contains the finding. JSON.stringify(report, null, 2)
    // emits a multi-line document; find the last top-level `{` to slice it
    // out (everything before is repair-pass progress lines, of which there
    // are none in this --fix-less run, so the entire trimmed sink IS JSON).
    const report = JSON.parse(sink.value.trim());
    expect(report.mcpSpawnCommands).toBeDefined();
    expect(report.mcpSpawnCommands.findings).toHaveLength(1);
    expect(report.mcpSpawnCommands.findings[0]).toMatchObject({
      platform: "kiro",
      command: "smith",
      resolvedAbsolute: STUB_SMITH,
    });
  });
});
