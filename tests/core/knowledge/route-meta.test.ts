import { describe, expect, it } from "bun:test";
import { extractMetaClaims } from "../../../src/core/knowledge/route-meta";
import type { McpToolDescriptor } from "../../../src/io/mcp-client";

describe("extractMetaClaims", () => {
  it("returns empty when no tool has the claim metadata", () => {
    const tools: McpToolDescriptor[] = [
      { name: "do_thing", description: "x" },
      { name: "list_things" },
    ];
    expect(extractMetaClaims("test-server", tools)).toEqual([]);
  });

  it("extracts a single tool's claims", () => {
    const tools: McpToolDescriptor[] = [
      {
        name: "fetch_page",
        _meta: { "dev.agent-smith/fetchDomains": ["https://wiki.test/**"] },
      },
    ];
    expect(extractMetaClaims("test-server", tools)).toEqual([
      { server: "test-server", tool: "fetch_page", urlPatterns: ["https://wiki.test/**"] },
    ]);
  });

  it("extracts multiple claim entries", () => {
    const tools: McpToolDescriptor[] = [
      {
        name: "fetch_a",
        _meta: { "dev.agent-smith/fetchDomains": ["https://a.test/**"] },
      },
      {
        name: "fetch_b",
        _meta: { "dev.agent-smith/fetchDomains": ["https://b.test/**", "https://c.test/**"] },
      },
    ];
    const claims = extractMetaClaims("srv", tools);
    expect(claims).toHaveLength(2);
    expect(claims[0]?.tool).toBe("fetch_a");
    expect(claims[1]?.urlPatterns).toEqual(["https://b.test/**", "https://c.test/**"]);
  });

  it("ignores non-array fetchDomains values", () => {
    const tools: McpToolDescriptor[] = [
      {
        name: "broken",
        _meta: { "dev.agent-smith/fetchDomains": "not-an-array" as unknown },
      },
    ];
    expect(extractMetaClaims("srv", tools)).toEqual([]);
  });

  it("ignores non-string entries inside the array", () => {
    const tools: McpToolDescriptor[] = [
      {
        name: "mixed",
        _meta: { "dev.agent-smith/fetchDomains": ["https://ok.test/**", 42, null, "https://also-ok.test/**"] as unknown[] },
      },
    ];
    const claims = extractMetaClaims("srv", tools);
    expect(claims[0]?.urlPatterns).toEqual(["https://ok.test/**", "https://also-ok.test/**"]);
  });

  it("matches a URL against extracted claims via matchMetaClaim", async () => {
    const { matchMetaClaim } = await import("../../../src/core/knowledge/route-meta");
    const claims = [
      { server: "srv", tool: "fetch_x", urlPatterns: ["https://wiki.test/**"] },
    ];
    expect(matchMetaClaim(claims, "https://wiki.test/page")).toEqual(claims[0]);
    expect(matchMetaClaim(claims, "https://other.test/page")).toBeUndefined();
  });
});
