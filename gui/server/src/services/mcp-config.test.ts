import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  detectMcpStatus,
  type PlatformMcpStatus,
  removeMcpEntry,
  writeMcpEntry,
} from "./mcp-config";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-config-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const SERVER_NAME = "agent-smith-knowledge";

function pathsUnder(r: string) {
  return {
    "claude-code": join(r, "claude.json"),
    opencode: join(r, "opencode.json"),
    codex: join(r, "codex.toml"),
    kiro: join(r, "kiro-mcp.json"),
  } as const;
}

describe("writeMcpEntry / removeMcpEntry — Claude Code (JSON, top-level mcpServers)", () => {
  it("creates a new file with the entry when none exists", async () => {
    const p = join(root, "claude.json");
    await writeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers[SERVER_NAME]).toEqual({
      command: "smith",
      args: ["knowledge", "serve", "foo", "--stdio"],
    });
  });

  it("preserves siblings on add", async () => {
    const p = join(root, "claude.json");
    await writeFile(
      p,
      JSON.stringify({
        someOtherTopKey: 1,
        mcpServers: { "github-mcp": { command: "gh-mcp", args: [] } },
      }),
    );
    await writeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.someOtherTopKey).toBe(1);
    expect(data.mcpServers["github-mcp"]).toEqual({ command: "gh-mcp", args: [] });
    expect(data.mcpServers[SERVER_NAME]).toBeDefined();
  });

  it("is idempotent — repeated writes produce the same result", async () => {
    const p = join(root, "claude.json");
    await writeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const first = await readFile(p, "utf8");
    await writeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const second = await readFile(p, "utf8");
    expect(first).toBe(second);
  });

  it("remove drops only the canonical entry, preserves siblings", async () => {
    const p = join(root, "claude.json");
    await writeFile(
      p,
      JSON.stringify({
        mcpServers: {
          "github-mcp": { command: "gh-mcp", args: [] },
          [SERVER_NAME]: { command: "smith", args: ["knowledge", "serve", "foo", "--stdio"] },
        },
      }),
    );
    await removeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers[SERVER_NAME]).toBeUndefined();
    expect(data.mcpServers["github-mcp"]).toEqual({ command: "gh-mcp", args: [] });
  });

  it("remove is idempotent when entry missing", async () => {
    const p = join(root, "claude.json");
    await writeFile(p, JSON.stringify({ mcpServers: {} }));
    await removeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers).toEqual({});
  });

  it("remove from missing file is a no-op (does not create the file)", async () => {
    const p = join(root, "claude.json");
    await removeMcpEntry({ platform: "claude-code", agent: "foo", configPath: p });
    const exists = await Bun.file(p).exists();
    expect(exists).toBe(false);
  });
});

describe("writeMcpEntry / removeMcpEntry — OpenCode (JSON, top-level mcp)", () => {
  it("uses the `mcp` key (not mcpServers)", async () => {
    const p = join(root, "opencode.json");
    await writeMcpEntry({ platform: "opencode", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcp[SERVER_NAME]).toEqual({
      command: "smith",
      args: ["knowledge", "serve", "foo", "--stdio"],
    });
    expect(data.mcpServers).toBeUndefined();
  });

  it("preserves OpenCode siblings", async () => {
    const p = join(root, "opencode.json");
    await writeFile(
      p,
      JSON.stringify({
        $schema: "https://opencode.example/schema.json",
        mcp: { "other-server": { command: "x", args: [] } },
      }),
    );
    await writeMcpEntry({ platform: "opencode", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.$schema).toBe("https://opencode.example/schema.json");
    expect(data.mcp["other-server"]).toEqual({ command: "x", args: [] });
    expect(data.mcp[SERVER_NAME]).toBeDefined();
  });
});

describe("writeMcpEntry / removeMcpEntry — Codex (TOML, [mcp_servers.<name>])", () => {
  it("creates a new TOML file with [mcp_servers.<name>]", async () => {
    const p = join(root, "codex.toml");
    await writeMcpEntry({ platform: "codex", agent: "foo", configPath: p });
    const text = await readFile(p, "utf8");
    const parsed = parseToml(text) as Record<string, unknown>;
    const mcp = parsed.mcp_servers as Record<string, { command: string; args: string[] }>;
    expect(mcp[SERVER_NAME]).toEqual({
      command: "smith",
      args: ["knowledge", "serve", "foo", "--stdio"],
    });
  });

  it("preserves other Codex sections (model, mcp_servers.<other>) on add and remove", async () => {
    const p = join(root, "codex.toml");
    await writeFile(
      p,
      [
        "model = \"gpt-5\"",
        "",
        "[mcp_servers.other]",
        "command = \"x\"",
        "args = []",
        "",
      ].join("\n"),
    );
    await writeMcpEntry({ platform: "codex", agent: "foo", configPath: p });
    let parsed = parseToml(await readFile(p, "utf8")) as Record<string, unknown>;
    expect(parsed.model).toBe("gpt-5");
    let mcp = parsed.mcp_servers as Record<string, { command: string; args: string[] }>;
    expect(mcp.other).toEqual({ command: "x", args: [] });
    expect(mcp[SERVER_NAME]).toBeDefined();

    await removeMcpEntry({ platform: "codex", agent: "foo", configPath: p });
    parsed = parseToml(await readFile(p, "utf8")) as Record<string, unknown>;
    expect(parsed.model).toBe("gpt-5");
    mcp = parsed.mcp_servers as Record<string, { command: string; args: string[] }>;
    expect(mcp.other).toEqual({ command: "x", args: [] });
    expect(mcp[SERVER_NAME]).toBeUndefined();
  });
});

describe("writeMcpEntry / removeMcpEntry — Kiro (JSON, top-level mcpServers)", () => {
  it("creates a new file with the mcpServers key", async () => {
    const p = join(root, "kiro-mcp.json");
    await writeMcpEntry({ platform: "kiro", agent: "foo", configPath: p });
    const data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers[SERVER_NAME]).toEqual({
      command: "smith",
      args: ["knowledge", "serve", "foo", "--stdio"],
    });
  });

  it("preserves siblings on add and remove", async () => {
    const p = join(root, "kiro-mcp.json");
    await writeFile(
      p,
      JSON.stringify({
        mcpServers: { "k-other": { command: "x", args: [] } },
      }),
    );
    await writeMcpEntry({ platform: "kiro", agent: "foo", configPath: p });
    let data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers["k-other"]).toEqual({ command: "x", args: [] });
    expect(data.mcpServers[SERVER_NAME]).toBeDefined();

    await removeMcpEntry({ platform: "kiro", agent: "foo", configPath: p });
    data = JSON.parse(await readFile(p, "utf8"));
    expect(data.mcpServers[SERVER_NAME]).toBeUndefined();
    expect(data.mcpServers["k-other"]).toEqual({ command: "x", args: [] });
  });
});

describe("detectMcpStatus", () => {
  it("returns one entry per platform with cliInstalled + hasEntry flags", async () => {
    const paths = pathsUnder(root);
    // Pre-populate Claude Code with the canonical entry.
    await writeFile(
      paths["claude-code"],
      JSON.stringify({
        mcpServers: {
          [SERVER_NAME]: { command: "smith", args: ["knowledge", "serve", "foo", "--stdio"] },
        },
      }),
    );
    // OpenCode missing entry. Codex + Kiro absent.
    await writeFile(paths.opencode, JSON.stringify({ mcp: {} }));

    const result = await detectMcpStatus({
      agent: "foo",
      paths,
      detectInstalled: async () => new Set(["claude-code", "opencode"]),
    });

    const byId = Object.fromEntries(result.map((s: PlatformMcpStatus) => [s.platform, s]));
    expect(byId["claude-code"]).toBeDefined();
    expect(byId["claude-code"]?.cliInstalled).toBe(true);
    expect(byId["claude-code"]?.hasEntry).toBe(true);
    expect(byId["claude-code"]?.configReadable).toBe(true);
    expect(byId.opencode?.cliInstalled).toBe(true);
    expect(byId.opencode?.hasEntry).toBe(false);
    expect(byId.codex?.cliInstalled).toBe(false);
    expect(byId.codex?.hasEntry).toBe(false);
    expect(byId.kiro?.cliInstalled).toBe(false);
  });

  it("treats a missing config file as configReadable=true with hasEntry=false (so writes can create it)", async () => {
    const paths = pathsUnder(root);
    const result = await detectMcpStatus({
      agent: "foo",
      paths,
      detectInstalled: async () => new Set(["claude-code"]),
    });
    const cc = result.find((s) => s.platform === "claude-code");
    expect(cc?.configReadable).toBe(true);
    expect(cc?.hasEntry).toBe(false);
  });
});
