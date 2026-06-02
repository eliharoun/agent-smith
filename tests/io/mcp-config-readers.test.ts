import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAvailableMcpServers } from "../../src/io/mcp-config-readers";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mcp-cfg-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("readAvailableMcpServers", () => {
  it("returns empty when no platform config exists", async () => {
    expect(await readAvailableMcpServers({ homeDir: home })).toEqual({});
  });

  it("reads claude-code from ~/.claude.json (user scope)", async () => {
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { x: { command: "/bin/x", args: [] } },
      }),
    );
    const r = await readAvailableMcpServers({ homeDir: home });
    expect(r.x?.command).toBe("/bin/x");
  });

  it("reads claude-code project-scope from projects.<dir>.mcpServers", async () => {
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        projects: { "/my/proj": { mcpServers: { y: { command: "/bin/y" } } } },
      }),
    );
    const r = await readAvailableMcpServers({ homeDir: home });
    expect(r.y).toBeDefined();
    expect(r.y?.command).toBe("/bin/y");
  });

  it("reads codex ~/.codex/config.toml mcp_servers", async () => {
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.z]\ncommand = "/bin/z"\nargs = []\n`,
    );
    const r = await readAvailableMcpServers({ homeDir: home });
    expect(r.z).toBeDefined();
    expect(r.z?.command).toBe("/bin/z");
  });

  it("reads opencode ~/.config/opencode/opencode.json mcp", async () => {
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ mcp: { w: { command: "/bin/w" } } }),
    );
    const r = await readAvailableMcpServers({ homeDir: home });
    expect(r.w).toBeDefined();
    expect(r.w?.command).toBe("/bin/w");
  });

  it("returns empty for missing files (no throw)", async () => {
    expect(await readAvailableMcpServers({ homeDir: "/nonexistent" })).toEqual({});
  });

  it("ignores malformed config (no throw)", async () => {
    await writeFile(join(home, ".claude.json"), "{ not json");
    expect(await readAvailableMcpServers({ homeDir: home })).toEqual({});
  });
});
