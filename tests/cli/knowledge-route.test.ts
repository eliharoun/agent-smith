import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { knowledgeRoute } from "../../src/cli/commands/knowledge/route";
import { SmithError } from "../../src/core/smith-error";
import type { McpClientPool } from "../../src/io/mcp-client-pool";
import type { McpToolDescriptor } from "../../src/io/mcp-client";

/** Build a fake pool whose acquire() returns a stub client wired to a
 *  per-server tools list — same pattern as tests/cli/knowledge/pick-via.test.ts. */
function fakePool(toolsByServer: Record<string, McpToolDescriptor[]>): McpClientPool {
  return {
    acquire: async (name: string) => {
      if (!(name in toolsByServer)) throw new Error(`unknown server: ${name}`);
      return { listTools: async () => toolsByServer[name] };
    },
    shutdown: async () => {},
    size: () => 0,
  } as unknown as McpClientPool;
}

const URL_TOOL: McpToolDescriptor = {
  name: "fetch_page",
  inputSchema: { type: "object", properties: { url: { type: "string" } } },
};

describe("knowledgeRoute", () => {
  let bundleDir: string;
  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-kr-"));
  });
  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
  });

  /** Write a bundle config with the given URL sources and mcpServers. */
  async function writeConfig(
    sources: Array<Record<string, unknown>>,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    await writeFile(
      join(bundleDir, "agent.config.json"),
      JSON.stringify({
        name: "x",
        description: "Use to test the route command.",
        targets: ["opencode"],
        modelTier: "balanced",
        mcpServers: ["bundle-fetcher"],
        ...extras,
        knowledge: { sources },
      }),
    );
  }

  it("routes a single source via --source flag", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
      { id: "beta", type: "url", delivery: "file", url: "https://example.test/b" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "beta",
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const alpha = cfg.knowledge.sources.find(
      (s: { id: string }) => s.id === "alpha",
    );
    const beta = cfg.knowledge.sources.find((s: { id: string }) => s.id === "beta");
    expect(alpha.via).toBeUndefined();
    expect(beta.via).toEqual({ server: "bundle-fetcher", tool: "fetch_page" });
  });

  it("routes all unrouted URL sources when no --source is passed", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
      { id: "beta", type: "url", delivery: "file", url: "https://example.test/b" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    // Both prompts pick server #1.
    const responses = ["1", "1"];
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => true,
      prompt: async () => responses.shift() ?? "0",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    for (const id of ["alpha", "beta"]) {
      const s = cfg.knowledge.sources.find((s: { id: string }) => s.id === id);
      expect(s.via).toEqual({ server: "bundle-fetcher", tool: "fetch_page" });
    }
  });

  it("skips sources that already have via: set when no --source is passed", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "preset", tool: "preset_tool" },
      },
      { id: "beta", type: "url", delivery: "file", url: "https://example.test/b" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const promptCalls: string[] = [];
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => true,
      prompt: async (msg) => {
        promptCalls.push(msg);
        return "1";
      },
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    const beta = cfg.knowledge.sources.find((s: { id: string }) => s.id === "beta");
    // alpha was untouched.
    expect(alpha.via).toEqual({ server: "preset", tool: "preset_tool" });
    // beta was routed.
    expect(beta.via).toEqual({ server: "bundle-fetcher", tool: "fetch_page" });
    // The picker was prompted only once (for beta), proving alpha was skipped.
    const choicePrompts = promptCalls.filter((m) => m.includes("Choice"));
    expect(choicePrompts).toHaveLength(1);
  });

  it("re-routes an already-routed source when --source targets it explicitly", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "old", tool: "old_tool" },
      },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "alpha",
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    expect(alpha.via).toEqual({ server: "bundle-fetcher", tool: "fetch_page" });
  });

  it("errors when --source <id> doesn't match any URL source", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const err = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "ghost",
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.identifier).toBe("ghost");
  });

  it("errors when the bundle has no URL sources", async () => {
    await writeConfig([
      { id: "local", type: "file", delivery: "file", path: "./README.md" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const err = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toMatch(/URL knowledge source/);
  });

  it("appends to mcpServers[] and mcp.required[] when picking a previously undeclared server", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
    ]);
    const pool = fakePool({ "ai-client-fetcher": [URL_TOOL] });
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => true,
      // Bundle has "bundle-fetcher" (1), available adds "ai-client-fetcher" (2).
      prompt: async () => "2",
      readAvailableMcpServers: async () => ({
        "ai-client-fetcher": { command: "ai-fetcher" },
      }),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    expect(cfg.mcpServers).toEqual(["bundle-fetcher", "ai-client-fetcher"]);
    expect(cfg.mcp?.required).toEqual(["ai-client-fetcher"]);
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    expect(alpha.via).toEqual({ server: "ai-client-fetcher", tool: "fetch_page" });
  });

  it("prints the summary with routed and skipped counts", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
      { id: "beta", type: "url", delivery: "file", url: "https://example.test/b" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const responses = ["1", "0"]; // route alpha, skip beta
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      const exit = await knowledgeRoute({
        bundleDir,
        agentName: "x",
        isTTY: () => true,
        prompt: async () => responses.shift() ?? "0",
        readAvailableMcpServers: async () => ({}),
        spawnOptsFor: () => ({ command: "ignored" }),
        pool,
      });
      expect(exit).toBe(0);
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => /Routed 1 sources, skipped 1/.test(l))).toBe(true);
    expect(logs.some((l) => /smith knowledge fetch x/.test(l))).toBe(true);
  });

  it("returns 0 with a hint when every URL source already has via: and no --source", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "preset", tool: "preset_tool" },
      },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    let acquireCalled = false;
    const wrappedPool = {
      ...pool,
      acquire: async () => {
        acquireCalled = true;
        return { listTools: async () => [URL_TOOL] };
      },
    } as unknown as McpClientPool;
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool: wrappedPool,
    });
    expect(exit).toBe(0);
    expect(acquireCalled).toBe(false);
  });

  it("clears via from a single routed source", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "preset", tool: "preset_tool" },
      },
      {
        id: "beta",
        type: "url",
        delivery: "file",
        url: "https://example.test/b",
        via: { server: "preset", tool: "preset_tool" },
      },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "alpha",
      clearVia: true,
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    const beta = cfg.knowledge.sources.find((s: { id: string }) => s.id === "beta");
    // alpha lost its via; beta retained its preset.
    expect(alpha.via).toBeUndefined();
    expect(beta.via).toEqual({ server: "preset", tool: "preset_tool" });
  });

  it("no-op message when source has no via", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    };
    let exit: number;
    try {
      exit = await knowledgeRoute({
        bundleDir,
        agentName: "x",
        sourceId: "alpha",
        clearVia: true,
        isTTY: () => true,
        prompt: async () => "1",
        readAvailableMcpServers: async () => ({}),
        spawnOptsFor: () => ({ command: "ignored" }),
        pool,
      });
    } finally {
      console.log = origLog;
    }
    expect(exit).toBe(0);
    expect(logs.some((l) => /already direct-HTTP; nothing to clear/.test(l))).toBe(true);
    // Config left unchanged on disk.
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    expect(alpha.via).toBeUndefined();
  });

  it("errors with exit 2 when --clear-via is passed without --source", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "preset", tool: "preset_tool" },
      },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const err = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      clearVia: true,
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("usage-error");
    expect(err.payload.message).toMatch(/--clear-via requires --source/);
  });

  it("errors with exit 1 when source not found under --clear-via", async () => {
    await writeConfig([
      {
        id: "alpha",
        type: "url",
        delivery: "file",
        url: "https://example.test/a",
        via: { server: "preset", tool: "preset_tool" },
      },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const err = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "ghost",
      clearVia: true,
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.identifier).toBe("ghost");
  });

  it("does NOT remove server from mcpServers[] or mcp.required[] when clearing", async () => {
    await writeConfig(
      [
        {
          id: "alpha",
          type: "url",
          delivery: "file",
          url: "https://example.test/a",
          via: { server: "shared-fetcher", tool: "fetch_page" },
        },
        {
          id: "beta",
          type: "url",
          delivery: "file",
          url: "https://example.test/b",
          via: { server: "shared-fetcher", tool: "fetch_page" },
        },
      ],
      {
        mcpServers: ["bundle-fetcher", "shared-fetcher"],
        mcp: { required: ["shared-fetcher"] },
      },
    );
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const exit = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      sourceId: "alpha",
      clearVia: true,
      isTTY: () => true,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    // Server lists must be untouched: beta still depends on shared-fetcher.
    expect(cfg.mcpServers).toEqual(["bundle-fetcher", "shared-fetcher"]);
    expect(cfg.mcp?.required).toEqual(["shared-fetcher"]);
    const alpha = cfg.knowledge.sources.find((s: { id: string }) => s.id === "alpha");
    const beta = cfg.knowledge.sources.find((s: { id: string }) => s.id === "beta");
    expect(alpha.via).toBeUndefined();
    expect(beta.via).toEqual({ server: "shared-fetcher", tool: "fetch_page" });
  });

  it("rejects non-TTY runs with a clear SmithError", async () => {
    await writeConfig([
      { id: "alpha", type: "url", delivery: "file", url: "https://example.test/a" },
    ]);
    const pool = fakePool({ "bundle-fetcher": [URL_TOOL] });
    const err = await knowledgeRoute({
      bundleDir,
      agentName: "x",
      isTTY: () => false,
      prompt: async () => "1",
      readAvailableMcpServers: async () => ({}),
      spawnOptsFor: () => ({ command: "ignored" }),
      pool,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.reasons.join(" ")).toMatch(/interactive-only/);
  });
});
