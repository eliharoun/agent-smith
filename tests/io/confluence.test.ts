import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { SmithError } from "../../src/core/smith-error";
import type { AtlassianAuth } from "../../src/io/atlassian-auth";
import { type ConfluenceFetchOpts, fetchConfluencePages } from "../../src/io/confluence";

const fakeAuth: AtlassianAuth = {
  email: "alice@x",
  token: "tok-A",
  source: "file-smith",
};

const originalFetch = globalThis.fetch;

// rc.4: Atlassian Cloud is workspace-scoped — there is no global default
// base URL. Every test that gets past the auth check needs a workspace
// URL set; tests that exercise the "missing base URL" path explicitly
// `delete process.env.SMITH_ATLASSIAN_BASE_URL` in their body.
beforeEach(() => {
  process.env.SMITH_ATLASSIAN_BASE_URL = "https://example.atlassian.net";
});

afterEach(() => {
  delete process.env.SMITH_ATLASSIAN_BASE_URL;
  globalThis.fetch = originalFetch;
});

describe("fetchConfluencePages: by-id", () => {
  test("fetches a single page by id and returns markdown artifact", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({
          id: "12345",
          title: "Architecture Overview",
          body: { storage: { value: "<h1>Hello</h1><p>World</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const opts: ConfluenceFetchOpts = {
      space: "ENG",
      pages: [{ id: 12345 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    };
    const result = await fetchConfluencePages(opts);

    expect(result.artifacts).toHaveLength(1);
    const a = result.artifacts[0]!;
    expect(a.filename).toBe("12345-architecture-overview.md");
    expect(a.relPath).toBe("12345-architecture-overview.md");
    expect(a.bytes.toString("utf8")).toContain("Hello");
    expect(a.bytes.toString("utf8")).toContain("World");
    expect(a.contentType).toBe("text/markdown");
    expect(result.warnings).toEqual([]);

    const sent = calls[0]!.init!.headers as Record<string, string>;
    const expectedAuth = `Basic ${Buffer.from("alice@x:tok-A").toString("base64")}`;
    expect(sent["Authorization"] ?? sent["authorization"]).toBe(expectedAuth);

    expect(calls[0]!.url).toMatch(/\/wiki\/api\/v2\/pages\/12345/);
  });

  test("respects SMITH_ATLASSIAN_BASE_URL env override", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({ id: "1", title: "x", body: { storage: { value: "<p>x</p>" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
      env: { SMITH_ATLASSIAN_BASE_URL: "https://example.atlassian.net" },
    });

    expect(calls[0]).toMatch(/^https:\/\/example\.atlassian\.net\/wiki\/api\/v2\/pages\/1/);
  });

  test("throws SmithError(usage-error) when resolver returns null", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchConfluencePages({
        space: "ENG",
        pages: [{ id: 1 }],
        resolveAuth: () => null,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("usage-error");
    expect((caught as SmithError).message).toContain("Atlassian credentials not configured");
  });

  test("strips <script> and <style> tags from rendered markdown", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "42",
          title: "Defended",
          body: {
            storage: {
              value:
                "<h1>Heading</h1><script>alert(1)</script><p>safe</p><style>.x{color:red}</style>",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 42 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });
    const md = result.artifacts[0]!.bytes.toString("utf8");
    expect(md).toContain("Heading");
    expect(md).toContain("safe");
    expect(md).not.toContain("alert(1)");
    expect(md).not.toContain("color:red");
  });

  test("format=storage returns .html artifact with raw HTML body", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "7",
          title: "Raw Page",
          body: { storage: { value: "<h1>raw</h1>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 7 }],
      format: "storage",
      resolveAuth: () => fakeAuth,
    });
    const a = result.artifacts[0]!;
    expect(a.filename).toBe("7-raw-page.html");
    expect(a.bytes.toString("utf8")).toBe("<h1>raw</h1>");
    expect(a.contentType).toBe("text/html");
  });

  test("format=view returns .html artifact with rendered HTML body", async () => {
    const captured: { bodyParam: string | null } = { bodyParam: null };
    globalThis.fetch = mock(async (url: string) => {
      captured.bodyParam = new URL(url).searchParams.get("body-format");
      return new Response(
        JSON.stringify({
          id: "8",
          title: "Rendered Page",
          body: { view: { value: "<div>rendered</div>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 8 }],
      format: "view",
      resolveAuth: () => fakeAuth,
    });
    expect(captured.bodyParam).toBe("view");
    const a = result.artifacts[0]!;
    expect(a.filename).toBe("8-rendered-page.html");
    expect(a.bytes.toString("utf8")).toBe("<div>rendered</div>");
  });
});

describe("fetchConfluencePages: by-title", () => {
  test("resolves a title to an id via space search, then fetches the page", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string) => {
      calls.push(url);
      if (url.includes("/wiki/api/v2/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "space-1", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/wiki/api/v2/spaces/") && url.includes("/pages")) {
        return new Response(
          JSON.stringify({
            results: [{ id: "999", title: "Architecture Overview" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          id: "999",
          title: "Architecture Overview",
          body: { storage: { value: "<p>arch</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: ["Architecture Overview"],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.filename).toBe("999-architecture-overview.md");
    expect(calls.some((c) => /\/wiki\/api\/v2\/spaces\/[^/]+\/pages/.test(c))).toBe(true);
  });

  test("throws SmithError(not-found) when title cannot be resolved", async () => {
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/wiki/api/v2/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "space-1", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchConfluencePages({
        space: "ENG",
        pages: ["Nonexistent Page"],
        resolveAuth: () => fakeAuth,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("Confluence page");
      expect(payload.identifier).toContain("Nonexistent Page");
      expect(payload.identifier).toContain("ENG");
    }
  });

  test("supports mixed array of titles and ids", async () => {
    let listCalls = 0;
    let detailCalls = 0;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/wiki/api/v2/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "space-1", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/spaces/") && url.includes("/pages") && !url.match(/\/pages\/\d+/)) {
        listCalls += 1;
        return new Response(JSON.stringify({ results: [{ id: "111", title: "By Title" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      detailCalls += 1;
      const id = url.match(/\/pages\/(\d+)/)?.[1] ?? "?";
      return new Response(
        JSON.stringify({
          id,
          title: id === "111" ? "By Title" : "By Id",
          body: { storage: { value: "<p>x</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: ["By Title", { id: 222 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(listCalls).toBe(1);
    expect(detailCalls).toBe(2);
    expect(result.artifacts.map((a) => a.filename).sort()).toEqual([
      "111-by-title.md",
      "222-by-id.md",
    ]);
  });

  test("paginates space page list when target title lives on a later page", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string) => {
      calls.push(url);
      if (url.includes("/wiki/api/v2/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "space-1", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // First page list call: cursor=undefined → returns 250 misses + next link
      if (url.includes("/wiki/api/v2/spaces/space-1/pages") && !url.includes("cursor=")) {
        const results = Array.from({ length: 250 }, (_, i) => ({
          id: `${1000 + i}`,
          title: `Other ${i}`,
        }));
        return new Response(
          JSON.stringify({
            results,
            _links: { next: "/wiki/api/v2/spaces/space-1/pages?cursor=abc&limit=250" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("cursor=abc")) {
        return new Response(
          JSON.stringify({
            results: [{ id: "999", title: "Deep Page" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // page detail
      return new Response(
        JSON.stringify({
          id: "999",
          title: "Deep Page",
          body: { storage: { value: "<p>found</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: ["Deep Page"],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.filename).toBe("999-deep-page.md");
    // Sanity: at least 2 list-pages calls happened (i.e., we paginated)
    const listCalls = calls.filter(
      (c) => c.includes("/spaces/space-1/pages") && !c.match(/\/pages\/\d+/),
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("fetchConfluencePages: by-space (no explicit pages)", () => {
  test("lists pages in space up to maxPages", async () => {
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/wiki/api/v2/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "space-1", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/wiki/api/v2/spaces/space-1/pages")) {
        return new Response(
          JSON.stringify({
            results: [
              { id: "1", title: "Page A" },
              { id: "2", title: "Page B" },
              { id: "3", title: "Page C" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const id = url.match(/\/pages\/(\d+)/)?.[1] ?? "?";
      return new Response(
        JSON.stringify({
          id,
          title: `Page ${String.fromCharCode(64 + Number(id))}`,
          body: { storage: { value: `<p>p${id}</p>` } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      maxPages: 2,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((a) => a.filename)).toEqual(["1-page-a.md", "2-page-b.md"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ENG/);
    expect(result.warnings[0]).toMatch(/3 pages/);
    expect(result.warnings[0]).toMatch(/fetched first 2/);
    expect(result.warnings[0]).toMatch(/`maxPages`/);
  });

  test("no warning when total pages ≤ maxPages", async () => {
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/spaces?keys=")) {
        return new Response(JSON.stringify({ results: [{ id: "s", key: "ENG" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/spaces/s/pages")) {
        return new Response(JSON.stringify({ results: [{ id: "1", title: "Only" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ id: "1", title: "Only", body: { storage: { value: "<p>x</p>" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      maxPages: 25,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});

describe("fetchConfluencePages: includeChildren recursion", () => {
  // Helper: build a fetch handler driven by a child-map and a body-map.
  function makeFetchWithChildren(opts: {
    childrenOf: Record<string, Array<{ id: string; title: string }>>;
    titleOf: Record<string, string>;
  }) {
    return mock(async (url: string) => {
      // children listing (v2)
      const childMatch = url.match(/\/wiki\/api\/v2\/pages\/(\d+)\/children/);
      if (childMatch) {
        const parentId = childMatch[1]!;
        const results = opts.childrenOf[parentId] ?? [];
        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // page detail
      const pageMatch = url.match(/\/wiki\/api\/v2\/pages\/(\d+)(?:\?|$)/);
      if (pageMatch) {
        const id = pageMatch[1]!;
        const title = opts.titleOf[id] ?? `Page ${id}`;
        return new Response(
          JSON.stringify({
            id,
            title,
            body: { storage: { value: `<p>body of ${id}</p>` } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
  }

  test("recurses one level: parent → 2 children", async () => {
    globalThis.fetch = makeFetchWithChildren({
      childrenOf: {
        "1": [
          { id: "10", title: "Child A" },
          { id: "11", title: "Child B" },
        ],
        "10": [],
        "11": [],
      },
      titleOf: { "1": "Parent", "10": "Child A", "11": "Child B" },
    });

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      includeChildren: true,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(result.artifacts.map((a) => a.filename).sort()).toEqual([
      "1-parent.md",
      "10-child-a.md",
      "11-child-b.md",
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("recurses deeply: parent → child → grandchild", async () => {
    globalThis.fetch = makeFetchWithChildren({
      childrenOf: {
        "1": [{ id: "10", title: "Child" }],
        "10": [{ id: "100", title: "Grandchild" }],
        "100": [],
      },
      titleOf: { "1": "Root", "10": "Child", "100": "Grandchild" },
    });

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      includeChildren: true,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(result.artifacts.map((a) => a.filename).sort()).toEqual([
      "1-root.md",
      "10-child.md",
      "100-grandchild.md",
    ]);
  });

  test("emits cap warning when descendants would exceed maxPages", async () => {
    globalThis.fetch = makeFetchWithChildren({
      childrenOf: {
        "1": [
          { id: "10", title: "C1" },
          { id: "11", title: "C2" },
          { id: "12", title: "C3" },
          { id: "13", title: "C4" },
        ],
        "10": [],
        "11": [],
        "12": [],
        "13": [],
      },
      titleOf: { "1": "P", "10": "C1", "11": "C2", "12": "C3", "13": "C4" },
    });

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      includeChildren: true,
      maxPages: 2,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(result.artifacts).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/`maxPages`/);
  });

  test("does NOT recurse when includeChildren is false (default)", async () => {
    let childCalls = 0;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/children")) {
        childCalls += 1;
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "1",
          title: "Lonely",
          body: { storage: { value: "<p>x</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });
    expect(result.artifacts).toHaveLength(1);
    expect(childCalls).toBe(0);
  });

  test("stops walking paginated children once maxPages cap is reached", async () => {
    // A single parent advertises an infinite chain of paginated children
    // pages. The walker must NOT keep following _links.next once it has
    // collected enough ids to satisfy maxPages.
    let childPageFetches = 0;
    globalThis.fetch = mock(async (url: string) => {
      const childMatch = url.match(/\/wiki\/api\/v2\/pages\/(\d+)\/children/);
      if (childMatch) {
        childPageFetches += 1;
        // Return 250 children + an always-present next cursor.
        const start = childPageFetches * 1000;
        const results = Array.from({ length: 250 }, (_, i) => ({
          id: `${start + i}`,
          title: `c${start + i}`,
        }));
        return new Response(
          JSON.stringify({
            results,
            _links: { next: `/wiki/api/v2/pages/1/children?cursor=${childPageFetches}&limit=250` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const pageMatch = url.match(/\/wiki\/api\/v2\/pages\/(\d+)(?:\?|$)/);
      if (pageMatch) {
        const id = pageMatch[1]!;
        return new Response(
          JSON.stringify({
            id,
            title: `t${id}`,
            body: { storage: { value: `<p>${id}</p>` } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 1 }],
      includeChildren: true,
      maxPages: 5,
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    // Exactly maxPages artifacts produced.
    expect(result.artifacts).toHaveLength(5);
    // Cap-hit warning emitted.
    expect(result.warnings.some((w) => /maxPages/.test(w))).toBe(true);
    // Critically: the walker did NOT keep paging through unbounded children.
    // First page already provides 250 ids → 5 needed → no more pages required.
    expect(childPageFetches).toBe(1);
  });
});

describe("fetchConfluencePages: 429 retry", () => {
  test("throws SmithError(permission-denied) on 403 from page fetch", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ message: "Permission denied to view content" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchConfluencePages({
        space: "ENG",
        pages: [{ id: 5 }],
        resolveAuth: () => fakeAuth,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("permission-denied");
  });
  test("retries once after Retry-After when first call returns 429", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(
        JSON.stringify({ id: "5", title: "OK", body: { storage: { value: "<p>ok</p>" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 5 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });
    expect(calls).toBe(2);
    expect(result.artifacts).toHaveLength(1);
  });

  test("captures persistent 429 into warnings (per-page)", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }) as unknown as typeof fetch;

    const result = await fetchConfluencePages({
      space: "ENG",
      pages: [{ id: 5 }],
      resolveAuth: () => fakeAuth,
    });
    expect(result.artifacts.length).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("page 5");
    expect(result.warnings[0]).toContain("rate-limited after 4 attempts");
    expect(calls).toBe(4);
  });

  test("caps Retry-After wait at 30s when server returns absurd value", async () => {
    let calls = 0;
    let waited = 0;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      waited = ms;
      // call immediately so test doesn't actually sleep
      return realSetTimeout(fn, 0);
    }) as typeof globalThis.setTimeout;
    try {
      globalThis.fetch = mock(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "86400" }, // 1 day
          });
        }
        return new Response(
          JSON.stringify({ id: "5", title: "OK", body: { storage: { value: "<p>ok</p>" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      await fetchConfluencePages({
        space: "ENG",
        pages: [{ id: 5 }],
        format: "markdown",
        resolveAuth: () => fakeAuth,
      });
      // Retry-After is capped at 30s base, then jittered to [15000, 45000).
      expect(waited).toBeGreaterThanOrEqual(15_000);
      expect(waited).toBeLessThan(45_000);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

describe("fetchConfluencePages partial-failure capture (IO-29)", () => {
  function buildFetch(handlers: Map<string, () => Response>): typeof fetch {
    return (async (url: RequestInfo | URL) => {
      const u = String(url);
      for (const [pattern, fn] of handlers) {
        if (u.includes(pattern)) return fn();
      }
      return new Response("not handled: " + u, { status: 500 });
    }) as typeof fetch;
  }

  test("captures a mid-walk per-page 5xx into warnings and returns earlier artifacts", async () => {
    const handlers = new Map<string, () => Response>([
      [
        "/spaces?keys=ENG",
        () =>
          new Response(JSON.stringify({ results: [{ id: "100", key: "ENG" }] }), { status: 200 }),
      ],
      [
        "/spaces/100/pages",
        () =>
          new Response(
            JSON.stringify({
              results: [
                { id: "1", title: "first" },
                { id: "2", title: "second" },
                { id: "3", title: "third" },
              ],
            }),
            { status: 200 },
          ),
      ],
      [
        "/pages/1?",
        () =>
          new Response(
            JSON.stringify({ id: "1", title: "first", body: { storage: { value: "<p>1</p>" } } }),
            { status: 200 },
          ),
      ],
      ["/pages/2?", () => new Response("server boom", { status: 500 })],
      [
        "/pages/3?",
        () =>
          new Response(
            JSON.stringify({ id: "3", title: "third", body: { storage: { value: "<p>3</p>" } } }),
            { status: 200 },
          ),
      ],
    ]);
    const result = await fetchConfluencePages({
      space: "ENG",
      maxPages: 25,
      resolveAuth: () => ({ email: "e@x", token: "t", source: "env-smith" }),
      env: { SMITH_ATLASSIAN_BASE_URL: "https://example.atlassian.net" } as NodeJS.ProcessEnv,
      fetch: buildFetch(handlers),
    });
    expect(result.artifacts.length).toBe(2);
    expect(result.artifacts.map((a) => a.filename)).toEqual(["1-first.md", "3-third.md"]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("page 2");
    expect(result.warnings[0]).toContain("Confluence");
    expect(result.warnings[0]).toContain("HTTP 500");
  });

  test("re-throws on auth-rejected mid-walk (no point continuing)", async () => {
    const handlers = new Map<string, () => Response>([
      [
        "/spaces?keys=ENG",
        () =>
          new Response(JSON.stringify({ results: [{ id: "100", key: "ENG" }] }), { status: 200 }),
      ],
      [
        "/spaces/100/pages",
        () =>
          new Response(
            JSON.stringify({
              results: [
                { id: "1", title: "first" },
                { id: "2", title: "second" },
              ],
            }),
            { status: 200 },
          ),
      ],
      [
        "/pages/1?",
        () =>
          new Response(
            JSON.stringify({ id: "1", title: "first", body: { storage: { value: "<p>1</p>" } } }),
            { status: 200 },
          ),
      ],
      ["/pages/2?", () => new Response("token expired", { status: 401 })],
    ]);
    let caught: unknown;
    try {
      await fetchConfluencePages({
        space: "ENG",
        maxPages: 25,
        resolveAuth: () => ({ email: "e@x", token: "t", source: "env-smith" }),
        env: { SMITH_ATLASSIAN_BASE_URL: "https://example.atlassian.net" } as NodeJS.ProcessEnv,
        fetch: buildFetch(handlers),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("permission-denied");
  });
});

describe("fetchConfluencePages: workspace URL not configured (rc.4)", () => {
  test("throws SmithError(usage-error) when no SMITH_ATLASSIAN_BASE_URL is set", async () => {
    // The beforeEach sets the env var; clear it to exercise the new
    // workspace-URL-missing path. Auth is resolved via a stub so we
    // get past the auth check and hit the new baseUrl guard.
    delete process.env.SMITH_ATLASSIAN_BASE_URL;
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called when baseUrl is missing");
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await fetchConfluencePages({
        space: "ENG",
        pages: [{ id: 1 }],
        resolveAuth: () => fakeAuth,
        env: {} as NodeJS.ProcessEnv,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("usage-error");
    expect((caught as SmithError).message).toContain("workspace URL not configured");
    expect((caught as SmithError).message).toContain("SMITH_ATLASSIAN_BASE_URL");
    expect((caught as SmithError).message).toContain("acme.atlassian.net");
  });
});
