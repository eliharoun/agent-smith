/**
 * Unit coverage for the `mcp-spawn-commands` doctor section.
 *
 * The check walks each platform's MCP config and flags every server whose
 * `command` field is not an absolute path. Bare command names like
 * "smith" are the canonical pre-fix legacy state from v2.1's MCP toggle —
 * GUI apps launched from Spotlight/dock don't inherit shell PATH so the
 * spawn fails silently. Already-absolute paths are passed through.
 *
 * For the `resolvedAbsolute` field we prefer:
 *   1) `process.argv[1]` realpath when command === "smith" (the doctor is
 *      itself being run by smith — that binary path is authoritative);
 *   2) a synchronous `which <command>` shell lookup against the user's
 *      shell PATH otherwise.
 * Neither resolving → `null`, signalling auto-fix to skip this finding
 * with a "can't auto-fix; install <name> first" warning.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { checkMcpSpawnCommands } from "../../../src/core/freshness/check-mcp-spawn";

interface Ctx {
  root: string;
  opencodeConfig: string;
  claudeMcpConfig: string;
  codexConfig: string;
  kiroMcpConfig: string;
}

let ctx: Ctx;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "smith-doctor-mcp-spawn-"));
  ctx = {
    root,
    opencodeConfig: join(root, "opencode", "opencode.json"),
    claudeMcpConfig: join(root, ".claude.json"),
    codexConfig: join(root, "codex", "config.toml"),
    kiroMcpConfig: join(root, "kiro", "settings", "mcp.json"),
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

function paths() {
  return {
    opencodeConfig: ctx.opencodeConfig,
    claudeMcpConfig: ctx.claudeMcpConfig,
    codexConfig: ctx.codexConfig,
    kiroMcpConfig: ctx.kiroMcpConfig,
  };
}

describe("checkMcpSpawnCommands", () => {
  test("clean: no config files exist → no findings", async () => {
    const r = await checkMcpSpawnCommands({ paths: paths() });
    expect(r.status).toBe("clean");
    expect(r.findings).toHaveLength(0);
  });

  test("clean: every command is already absolute → no findings", async () => {
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": {
          command: "/usr/local/bin/smith",
          args: ["knowledge", "serve", "alpha", "--stdio"],
        },
      },
    });
    await writeJson(ctx.claudeMcpConfig, {
      mcpServers: {
        other: { command: "/opt/bin/other", args: [] },
      },
    });
    await writeJson(ctx.opencodeConfig, {
      mcp: { foo: { command: "/usr/bin/foo", args: [] } },
    });
    await writeTomlFile(ctx.codexConfig, {
      mcp_servers: {
        bar: { command: "/usr/bin/bar", args: [] },
      },
    });

    const r = await checkMcpSpawnCommands({ paths: paths() });
    expect(r.status).toBe("clean");
    expect(r.findings).toHaveLength(0);
  });

  test("fragile-spawn: bare \"smith\" in Kiro flagged, resolvedAbsolute=process.argv[1] realpath", async () => {
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        "agent-smith-knowledge": {
          command: "smith",
          args: ["knowledge", "serve", "alpha", "--stdio"],
        },
      },
    });

    const stubSmithPath = "/stub/abs/smith";
    const r = await checkMcpSpawnCommands({
      paths: paths(),
      resolveSmithPath: () => stubSmithPath,
    });
    expect(r.status).toBe("fragile-spawn");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "kiro",
      configPath: ctx.kiroMcpConfig,
      serverName: "agent-smith-knowledge",
      command: "smith",
      resolvedAbsolute: stubSmithPath,
    });
  });

  test("fragile-spawn: bare \"git\" still flagged (resolvable now ≠ resolvable from Spotlight)", async () => {
    await writeJson(ctx.claudeMcpConfig, {
      mcpServers: {
        "git-helper": { command: "git", args: ["log"] },
      },
    });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      which: (cmd) => (cmd === "git" ? "/usr/bin/git" : null),
    });
    expect(r.status).toBe("fragile-spawn");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "claude-code",
      serverName: "git-helper",
      command: "git",
      resolvedAbsolute: "/usr/bin/git",
    });
  });

  test("fragile-spawn: unresolvable command → resolvedAbsolute null", async () => {
    await writeJson(ctx.opencodeConfig, {
      mcp: { ghost: { command: "definitely-not-installed-xyz", args: [] } },
    });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      which: () => null,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "opencode",
      serverName: "ghost",
      command: "definitely-not-installed-xyz",
      resolvedAbsolute: null,
    });
  });

  test("absolute paths skipped, bare names flagged in mixed config", async () => {
    await writeJson(ctx.kiroMcpConfig, {
      mcpServers: {
        good: { command: "/usr/local/bin/smith", args: [] },
        bad: { command: "smith", args: [] },
      },
    });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      resolveSmithPath: () => "/abs/smith",
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "kiro",
      serverName: "bad",
      command: "smith",
    });
  });

  test("Codex TOML: bare command in [mcp_servers.x] flagged", async () => {
    await writeTomlFile(ctx.codexConfig, {
      mcp_servers: {
        "agent-smith-knowledge": {
          command: "smith",
          args: ["knowledge", "serve", "x", "--stdio"],
        },
      },
    });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      resolveSmithPath: () => "/realpath/smith",
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "codex",
      configPath: ctx.codexConfig,
      serverName: "agent-smith-knowledge",
      command: "smith",
      resolvedAbsolute: "/realpath/smith",
    });
  });

  test("Claude Code: project-scope mcpServers under projects.<dir>.mcpServers also walked", async () => {
    await writeJson(ctx.claudeMcpConfig, {
      mcpServers: {
        "user-scope": { command: "/abs/ok", args: [] },
      },
      projects: {
        "/Users/test/proj": {
          mcpServers: {
            "project-bad": { command: "smith", args: [] },
          },
        },
      },
    });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      resolveSmithPath: () => "/abs/smith",
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      platform: "claude-code",
      serverName: "project-bad",
      command: "smith",
    });
  });

  test("malformed JSON config skipped silently (no findings, no throw)", async () => {
    await mkdir(join(ctx.kiroMcpConfig, ".."), { recursive: true });
    await writeFile(ctx.kiroMcpConfig, "{ not valid json", "utf8");

    const r = await checkMcpSpawnCommands({ paths: paths() });
    expect(r.status).toBe("clean");
    expect(r.findings).toHaveLength(0);
  });

  test("entry without a string command field skipped (defensive)", async () => {
    await writeJson(ctx.opencodeConfig, {
      mcp: {
        weird: { args: ["no", "command"] },
        nested: { command: { not: "a string" }, args: [] },
      },
    });
    const r = await checkMcpSpawnCommands({ paths: paths() });
    expect(r.findings).toHaveLength(0);
  });

  test("aggregates findings across all four platforms", async () => {
    await writeJson(ctx.opencodeConfig, { mcp: { a: { command: "smith" } } });
    await writeJson(ctx.claudeMcpConfig, { mcpServers: { b: { command: "smith" } } });
    await writeTomlFile(ctx.codexConfig, { mcp_servers: { c: { command: "smith" } } });
    await writeJson(ctx.kiroMcpConfig, { mcpServers: { d: { command: "smith" } } });

    const r = await checkMcpSpawnCommands({
      paths: paths(),
      resolveSmithPath: () => "/abs/smith",
    });
    expect(r.findings).toHaveLength(4);
    const platforms = r.findings.map((f) => f.platform).sort();
    expect(platforms).toEqual(["claude-code", "codex", "kiro", "opencode"]);
  });
});
