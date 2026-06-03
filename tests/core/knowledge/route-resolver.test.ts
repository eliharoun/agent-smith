import { describe, expect, it } from "bun:test";
import { resolveRoute } from "../../../src/core/knowledge/route-resolver";
import { EMPTY_CACHE } from "../../../src/core/knowledge/route-cache";

describe("resolveRoute", () => {
  it("returns null when no layer matches", () => {
    expect(resolveRoute({
      url: "https://nowhere.example/x",
      cache: EMPTY_CACHE,
      metaClaims: [],
    })).toBeNull();
  });

  it("returns Layer 1 (curated) when only it matches", () => {
    const r = resolveRoute({
      url: "https://acme.atlassian.net/wiki/spaces/X/pages/1/Y",
      cache: EMPTY_CACHE,
      metaClaims: [],
    });
    expect(r?.source).toBe("curated");
  });

  it("returns Layer 2 (_meta) when claim matches and registry doesn't", () => {
    const r = resolveRoute({
      url: "https://wiki.internal.test/page",
      cache: EMPTY_CACHE,
      metaClaims: [{ server: "srv", tool: "fetch_page", urlPatterns: ["https://wiki.internal.test/**"] }],
    });
    expect(r?.source).toBe("_meta");
    expect(r?.server).toBe("srv");
  });

  it("returns Layer 3 (cache) when only cache matches", () => {
    const cache = {
      schemaVersion: 1 as const,
      entries: [{ urlPattern: "https://learned.test/**", server: "cached", tool: "fetch", learnedAt: "x", hits: 5 }],
    };
    const r = resolveRoute({
      url: "https://learned.test/page",
      cache,
      metaClaims: [],
    });
    expect(r?.source).toBe("cache");
    expect(r?.server).toBe("cached");
  });

  it("user cache wins over _meta when both match (user confirmation > server claim)", () => {
    const cache = {
      schemaVersion: 1 as const,
      entries: [{ urlPattern: "https://both.test/**", server: "from-cache", tool: "f", learnedAt: "x", hits: 1 }],
    };
    const r = resolveRoute({
      url: "https://both.test/x",
      cache,
      metaClaims: [{ server: "from-meta", tool: "f", urlPatterns: ["https://both.test/**"] }],
    });
    expect(r?.source).toBe("cache");
  });

  it("_meta wins over curated when both match", () => {
    const r = resolveRoute({
      url: "https://acme.atlassian.net/wiki/spaces/X/pages/1/Y",
      cache: EMPTY_CACHE,
      metaClaims: [{ server: "self-claim", tool: "f", urlPatterns: ["https://acme.atlassian.net/wiki/**"] }],
    });
    expect(r?.source).toBe("_meta");
  });
});
