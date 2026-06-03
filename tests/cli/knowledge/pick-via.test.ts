import { describe, expect, it } from "bun:test";
import {
  buildServerCandidates,
  pickViaInteractively,
} from "../../../src/cli/commands/knowledge/pick-via";
import type { McpToolDescriptor } from "../../../src/io/mcp-client";
import type { McpClientPool } from "../../../src/io/mcp-client-pool";
import { SmithError } from "../../../src/core/smith-error";

/** Build a fake pool whose acquire() returns a stub client wired to a
 *  per-server tools list. No subprocess is spawned. */
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
const URL_TOOL_2: McpToolDescriptor = {
  name: "preview_page",
  inputSchema: { type: "object", properties: { url: { type: "string" } } },
};
const URL_TOOL_ARRAY: McpToolDescriptor = {
  name: "fetch_many_pages",
  inputSchema: {
    type: "object",
    properties: { inputs: { type: "array", items: { type: "string" } } },
  },
};
const NON_URL_TOOL: McpToolDescriptor = {
  name: "search_index",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
};

describe("buildServerCandidates", () => {
  it("places bundle servers first in declaration order, then available-only", () => {
    const out = buildServerCandidates(["b1", "b2"], { b1: {}, a1: {}, a2: {} });
    expect(out).toEqual([
      { name: "b1", origin: "bundle" },
      { name: "b2", origin: "bundle" },
      { name: "a1", origin: "available" },
      { name: "a2", origin: "available" },
    ]);
  });

  it("dedupes when a name is in both lists (bundle wins)", () => {
    const out = buildServerCandidates(["shared"], { shared: {}, other: {} });
    expect(out).toEqual([
      { name: "shared", origin: "bundle" },
      { name: "other", origin: "available" },
    ]);
  });

  it("returns empty when both lists are empty", () => {
    expect(buildServerCandidates([], {})).toEqual([]);
  });
});

describe("pickViaInteractively", () => {
  it("returns null when input is empty (skip)", async () => {
    const pool = fakePool({ s1: [URL_TOOL] });
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "",
      notify: () => {},
    });
    expect(result).toBeNull();
  });

  it("returns null when input is '0' (explicit skip)", async () => {
    const pool = fakePool({ s1: [URL_TOOL] });
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "0",
      notify: () => {},
    });
    expect(result).toBeNull();
  });

  it("returns null when there are no candidate servers (caller falls through)", async () => {
    const pool = fakePool({});
    const promptCalls: string[] = [];
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: [],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async (msg) => {
        promptCalls.push(msg);
        return "";
      },
      notify: () => {},
    });
    expect(result).toBeNull();
    expect(promptCalls).toEqual([]);
  });

  it("auto-selects the lone URL-shaped tool when picking a bundle server", async () => {
    const pool = fakePool({ s1: [URL_TOOL, NON_URL_TOOL] });
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "1",
      notify: () => {},
    });
    expect(result).toEqual({
      server: "s1",
      tool: "fetch_page",
      serverWasAdded: false,
    });
  });

  it("flags serverWasAdded when picking an available-only server", async () => {
    const pool = fakePool({ a1: [URL_TOOL] });
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: [],
      availableMcpServers: { a1: { command: "x" } },
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "1",
      notify: () => {},
    });
    expect(result).toEqual({
      server: "a1",
      tool: "fetch_page",
      serverWasAdded: true,
    });
  });

  it("throws SmithError when chosen server has zero URL-shaped tools", async () => {
    const pool = fakePool({ s1: [NON_URL_TOOL] });
    const err = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "1",
      notify: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.reasons.join(" ")).toMatch(/no URL-shaped tools/);
  });

  it("prompts a second time when the chosen server has 2+ URL-shaped tools", async () => {
    const pool = fakePool({
      s1: [URL_TOOL, URL_TOOL_ARRAY, URL_TOOL_2],
    });
    const responses = ["1", "2"]; // pick server 1, then tool 2
    const result = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => responses.shift() ?? "",
      notify: () => {},
    });
    expect(result).toEqual({
      server: "s1",
      tool: "fetch_many_pages",
      serverWasAdded: false,
    });
  });

  it("rejects an out-of-range server pick with a clear SmithError", async () => {
    const pool = fakePool({ s1: [URL_TOOL] });
    const err = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["s1"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "9",
      notify: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toMatch(/MCP server picker input/);
  });

  it("surfaces a SmithError when the chosen server fails to spawn", async () => {
    // fakePool throws "unknown server: missing" — the picker must wrap it.
    const pool = fakePool({});
    const err = await pickViaInteractively({
      url: "https://example.test/x",
      currentMcpServers: ["missing"],
      availableMcpServers: {},
      pool,
      spawnOptsFor: () => ({ command: "ignored" }),
      prompt: async () => "1",
      notify: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.reasons.join(" ")).toMatch(/failed to spawn or list tools/);
  });
});
