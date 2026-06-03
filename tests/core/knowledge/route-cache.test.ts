import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRouteCache,
  saveRouteCache,
  matchCachedRoute,
  recordRoute,
  EMPTY_CACHE,
} from "../../../src/core/knowledge/route-cache";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "route-cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("route-cache", () => {
  it("loadRouteCache returns EMPTY_CACHE when file missing", async () => {
    const c = await loadRouteCache({ stateHome: dir });
    expect(c).toEqual(EMPTY_CACHE);
  });

  it("saveRouteCache then loadRouteCache round-trips", async () => {
    const cache = {
      schemaVersion: 1 as const,
      entries: [{
        urlPattern: "https://example.test/**",
        server: "x",
        tool: "fetch",
        learnedAt: "2026-06-02T00:00:00Z",
        hits: 1,
      }],
    };
    await saveRouteCache({ stateHome: dir }, cache);
    const loaded = await loadRouteCache({ stateHome: dir });
    expect(loaded).toEqual(cache);
  });

  it("loadRouteCache returns EMPTY_CACHE on malformed JSON", async () => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(dir, "url-routing.json"), "{ not json");
    const c = await loadRouteCache({ stateHome: dir });
    expect(c).toEqual(EMPTY_CACHE);
  });

  it("loadRouteCache returns EMPTY_CACHE on schemaVersion mismatch", async () => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(dir, "url-routing.json"),
      JSON.stringify({ schemaVersion: 99, entries: [] }),
    );
    const c = await loadRouteCache({ stateHome: dir });
    expect(c).toEqual(EMPTY_CACHE);
  });

  it("matchCachedRoute matches host-prefix patterns", () => {
    const cache = {
      schemaVersion: 1 as const,
      entries: [
        { urlPattern: "https://wiki.test/**", server: "a", tool: "f", learnedAt: "x", hits: 1 },
      ],
    };
    expect(matchCachedRoute(cache, "https://wiki.test/page/123")).toBeDefined();
    expect(matchCachedRoute(cache, "https://other.test/page")).toBeUndefined();
  });

  it("matchCachedRoute prefers most-specific (longest) pattern on overlap", () => {
    const cache = {
      schemaVersion: 1 as const,
      entries: [
        { urlPattern: "https://wiki.test/**", server: "broad", tool: "f", learnedAt: "x", hits: 1 },
        { urlPattern: "https://wiki.test/team/**", server: "specific", tool: "f", learnedAt: "x", hits: 1 },
      ],
    };
    expect(matchCachedRoute(cache, "https://wiki.test/team/foo")?.server).toBe("specific");
    expect(matchCachedRoute(cache, "https://wiki.test/anything-else")?.server).toBe("broad");
  });

  it("recordRoute upserts (server, tool, host) triple — second call increments hits, doesn't duplicate", () => {
    let c = EMPTY_CACHE;
    c = recordRoute(c, { url: "https://wiki.test/a", server: "x", tool: "fetch", now: "2026-01-01T00:00:00Z" });
    c = recordRoute(c, { url: "https://wiki.test/b", server: "x", tool: "fetch", now: "2026-01-02T00:00:00Z" });
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0]?.hits).toBe(2);
    expect(c.entries[0]?.urlPattern).toBe("https://wiki.test/**");
  });

  it("recordRoute creates separate entries for different (server, tool, host)", () => {
    let c = EMPTY_CACHE;
    c = recordRoute(c, { url: "https://a.test/x", server: "s1", tool: "fetch", now: "x" });
    c = recordRoute(c, { url: "https://a.test/y", server: "s2", tool: "fetch", now: "x" });
    c = recordRoute(c, { url: "https://b.test/z", server: "s1", tool: "fetch", now: "x" });
    expect(c.entries).toHaveLength(3);
  });
});
