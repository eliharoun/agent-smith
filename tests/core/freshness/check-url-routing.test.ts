import { describe, expect, it } from "bun:test";
import { checkUrlRouting } from "../../../src/core/freshness/check-url-routing";
import { EMPTY_CACHE } from "../../../src/core/knowledge/route-cache";

describe("checkUrlRouting", () => {
  it("returns curated entries when both _meta and cache are empty", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => EMPTY_CACHE,
      listMetaClaims: async () => [],
    });
    // Curated entries always populate from `_listPatterns()`, so the entry
    // list is non-empty even under empty inputs. Every entry must be from
    // the "curated" layer; no _meta or cache entries leaked through.
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.source === "curated")).toBe(true);
    expect(result.ambiguities).toEqual([]);
  });

  it("returns only cache entries when curated patterns are unique and _meta is empty", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => ({
        schemaVersion: 1,
        entries: [
          {
            urlPattern: "https://wiki.test/**",
            server: "internal-wiki",
            tool: "fetch_page",
            learnedAt: "2026-06-02T00:00:00.000Z",
            hits: 3,
          },
        ],
      }),
      listMetaClaims: async () => [],
    });
    const cacheEntries = result.entries.filter((e) => e.source === "cache");
    expect(cacheEntries).toEqual([
      {
        urlPattern: "https://wiki.test/**",
        source: "cache",
        server: "internal-wiki",
        tool: "fetch_page",
      },
    ]);
    // No ambiguity — pattern is unique to one (server, tool) pair.
    expect(result.ambiguities).toEqual([]);
  });

  it("emits one entry per claim's urlPatterns element from _meta", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => EMPTY_CACHE,
      listMetaClaims: async () => [
        {
          server: "docs-mcp",
          tool: "fetch",
          urlPatterns: ["https://docs.test/**", "https://api-docs.test/**"],
        },
      ],
    });
    const metaEntries = result.entries.filter((e) => e.source === "_meta");
    expect(metaEntries).toEqual([
      {
        urlPattern: "https://docs.test/**",
        source: "_meta",
        server: "docs-mcp",
        tool: "fetch",
      },
      {
        urlPattern: "https://api-docs.test/**",
        source: "_meta",
        server: "docs-mcp",
        tool: "fetch",
      },
    ]);
    expect(result.ambiguities).toEqual([]);
  });

  it("orders entries: curated, then _meta, then cache", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => ({
        schemaVersion: 1,
        entries: [
          {
            urlPattern: "https://learned.test/**",
            server: "learned-mcp",
            tool: "fetch",
            learnedAt: "2026-06-02T00:00:00.000Z",
            hits: 1,
          },
        ],
      }),
      listMetaClaims: async () => [
        {
          server: "advertised-mcp",
          tool: "fetch",
          urlPatterns: ["https://advertised.test/**"],
        },
      ],
    });
    const sources = result.entries.map((e) => e.source);
    const firstMeta = sources.indexOf("_meta");
    const firstCache = sources.indexOf("cache");
    const lastCurated = sources.lastIndexOf("curated");
    expect(firstMeta).toBeGreaterThan(lastCurated);
    expect(firstCache).toBeGreaterThan(firstMeta);
  });

  it("flags an ambiguity when two distinct (server, tool) pairs claim the same pattern", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => ({
        schemaVersion: 1,
        entries: [
          {
            urlPattern: "https://shared.test/**",
            server: "cached-mcp",
            tool: "fetch_page",
            learnedAt: "2026-06-02T00:00:00.000Z",
            hits: 2,
          },
        ],
      }),
      listMetaClaims: async () => [
        {
          server: "advertised-mcp",
          tool: "read_doc",
          urlPatterns: ["https://shared.test/**"],
        },
      ],
    });
    expect(result.ambiguities).toHaveLength(1);
    const a = result.ambiguities[0]!;
    expect(a.urlPattern).toBe("https://shared.test/**");
    expect(a.claimants.length).toBe(2);
    const tuples = a.claimants.map((c) => `${c.server}.${c.tool}`).sort();
    expect(tuples).toEqual(["advertised-mcp.read_doc", "cached-mcp.fetch_page"]);
  });

  it("does not flag an ambiguity when the same (server, tool) advertises a pattern from two layers", async () => {
    // Same (server, tool) appearing in both _meta and cache is the same
    // route — not ambiguous. The merge collapses duplicates by
    // (server, tool) within a single pattern.
    const result = await checkUrlRouting({
      loadCache: async () => ({
        schemaVersion: 1,
        entries: [
          {
            urlPattern: "https://only.test/**",
            server: "the-mcp",
            tool: "fetch",
            learnedAt: "2026-06-02T00:00:00.000Z",
            hits: 1,
          },
        ],
      }),
      listMetaClaims: async () => [
        {
          server: "the-mcp",
          tool: "fetch",
          urlPatterns: ["https://only.test/**"],
        },
      ],
    });
    expect(result.ambiguities).toEqual([]);
    // Both entries still appear in the table — the doctor view shows
    // them from each layer for transparency.
    const matches = result.entries.filter((e) => e.urlPattern === "https://only.test/**");
    const sources = new Set(matches.map((e) => e.source));
    expect(sources.has("_meta")).toBe(true);
    expect(sources.has("cache")).toBe(true);
  });

  it("returns ambiguities sorted lexicographically by urlPattern", async () => {
    const result = await checkUrlRouting({
      loadCache: async () => EMPTY_CACHE,
      listMetaClaims: async () => [
        {
          server: "z-mcp",
          tool: "fetch",
          urlPatterns: ["https://zeta.test/**", "https://alpha.test/**"],
        },
        {
          server: "a-mcp",
          tool: "fetch",
          urlPatterns: ["https://zeta.test/**", "https://alpha.test/**"],
        },
      ],
    });
    expect(result.ambiguities.map((a) => a.urlPattern)).toEqual([
      "https://alpha.test/**",
      "https://zeta.test/**",
    ]);
  });
});
