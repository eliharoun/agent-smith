import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalConfig } from "../../src/core/types";
import { checkMcpAvailability } from "../../src/io/mcp-availability";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-mcp-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const baseConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "x",
  description: "Reviews things",
  targets: ["opencode", "claude-code", "codex"],
  modelTier: "balanced",
};

describe("io/mcp-availability", () => {
  test("returns no warnings when mcpServers is absent", async () => {
    const w = await checkMcpAvailability(baseConfig, {
      opencodeConfig: join(tmp, "opencode.json"),
      claudeMcpConfig: join(tmp, "mcp.json"),
      codexConfig: join(tmp, "config.toml"),
    });
    expect(w).toEqual([]);
  });

  test("returns no warnings when mcpServers is empty", async () => {
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: [] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("reads opencode mcp servers from opencode.json", async () => {
    await writeFile(
      join(tmp, "opencode.json"),
      JSON.stringify({ mcp: { github: {}, linear: {} } }),
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["opencode"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("warns when opencode is missing a required server", async () => {
    await writeFile(join(tmp, "opencode.json"), JSON.stringify({ mcp: { linear: {} } }));
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["opencode"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toContain("MCP server 'github' referenced but not configured for opencode");
  });

  test("reads claude-code user-scope mcp servers from top-level mcpServers in ~/.claude.json", async () => {
    await writeFile(
      join(tmp, "claude.json"),
      JSON.stringify({ mcpServers: { github: {} } }),
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["claude-code"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "claude.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("reads claude-code local-scope mcp servers from projects.<path>.mcpServers", async () => {
    await writeFile(
      join(tmp, "claude.json"),
      JSON.stringify({
        projects: {
          "/some/project": { mcpServers: { linear: {} } },
          "/other/project": { mcpServers: { sentry: {} } },
        },
      }),
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["linear", "sentry"], targets: ["claude-code"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "claude.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("warns when claude-code is missing a required server (not in user or any project scope)", async () => {
    await writeFile(
      join(tmp, "claude.json"),
      JSON.stringify({
        mcpServers: { linear: {} },
        projects: { "/some/project": { mcpServers: { sentry: {} } } },
      }),
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["claude-code"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "claude.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toContain("MCP server 'github' referenced but not configured for claude-code");
  });

  test("reads codex mcp servers from [mcp_servers.<name>] sections per official spec", async () => {
    await writeFile(
      join(tmp, "config.toml"),
      '[mcp_servers.github]\ncommand = "github-mcp"\n[mcp_servers.linear]\ncommand = "linear-mcp"\n',
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["codex"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("warns when codex is missing a required server", async () => {
    await writeFile(
      join(tmp, "config.toml"),
      '[mcp_servers.linear]\ncommand = "linear-mcp"\n',
    );
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["codex"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toContain("MCP server 'github' referenced but not configured for codex");
  });

  test("missing config files are silent (no warnings, not errors)", async () => {
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["opencode"] },
      {
        opencodeConfig: join(tmp, "does-not-exist.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });

  test("checks all targets and reports warnings per target", async () => {
    await writeFile(join(tmp, "opencode.json"), JSON.stringify({ mcp: { linear: {} } }));
    await writeFile(join(tmp, "mcp.json"), JSON.stringify({ mcpServers: { github: {} } }));
    const w = await checkMcpAvailability(
      {
        ...baseConfig,
        mcpServers: ["github", "linear"],
        targets: ["opencode", "claude-code"],
      },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toContain("MCP server 'github' referenced but not configured for opencode");
    expect(w).toContain("MCP server 'linear' referenced but not configured for claude-code");
    expect(w).not.toContain("MCP server 'linear' referenced but not configured for opencode");
    expect(w).not.toContain("MCP server 'github' referenced but not configured for claude-code");
  });

  test("malformed config files are silent (parse errors swallowed)", async () => {
    await writeFile(join(tmp, "opencode.json"), "{not valid json");
    await writeFile(join(tmp, "config.toml"), "this = is = not = toml");
    const w = await checkMcpAvailability(
      { ...baseConfig, mcpServers: ["github"], targets: ["opencode", "codex"] },
      {
        opencodeConfig: join(tmp, "opencode.json"),
        claudeMcpConfig: join(tmp, "mcp.json"),
        codexConfig: join(tmp, "config.toml"),
      },
    );
    expect(w).toEqual([]);
  });
});
