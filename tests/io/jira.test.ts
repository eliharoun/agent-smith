import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { SmithError } from "../../src/core/smith-error";
import type { AtlassianAuth } from "../../src/io/atlassian-auth";
import { type JiraSearchOpts, searchJiraIssues } from "../../src/io/jira";

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

describe("searchJiraIssues: single page", () => {
  test("POSTs to /rest/api/3/search/jql with jql and returns one artifact per issue", async () => {
    const captured: { url: string | null; init: RequestInit | null } = {
      url: null,
      init: null,
    };
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init ?? null;
      return new Response(
        JSON.stringify({
          issues: [
            {
              key: "ENG-1234",
              fields: {
                summary: "Fix the thing",
                description: "Long description here",
                status: { name: "In Progress" },
              },
            },
            {
              key: "ENG-1235",
              fields: {
                summary: "Another bug",
                description: null,
                status: { name: "Open" },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const opts: JiraSearchOpts = {
      jql: "project = ENG AND status = 'In Progress'",
      resolveAuth: () => fakeAuth,
    };
    const artifacts = await searchJiraIssues(opts);

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]!.filename).toBe("ENG-1234.md");
    expect(artifacts[0]!.relPath).toBe("ENG-1234.md");
    expect(artifacts[0]!.contentType).toBe("text/markdown");
    const md = artifacts[0]!.bytes.toString("utf8");
    expect(md).toContain("ENG-1234");
    expect(md).toContain("Fix the thing");
    expect(md).toContain("Long description here");

    expect(captured.url).toMatch(/\/rest\/api\/3\/search\/jql$/);
    expect(captured.init!.method).toBe("POST");
    const body = JSON.parse(captured.init!.body as string);
    expect(body.jql).toBe("project = ENG AND status = 'In Progress'");
    const sent = captured.init!.headers as Record<string, string>;
    expect(sent["Authorization"] ?? sent["authorization"]).toBe(
      `Basic ${Buffer.from("alice@x:tok-A").toString("base64")}`,
    );
    expect(sent["Content-Type"] ?? sent["content-type"]).toMatch(/application\/json/);
  });

  test("forwards custom fields array in request body", async () => {
    const captured: { body: unknown } = { body: null };
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      captured.body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await searchJiraIssues({
      jql: "project = ENG",
      fields: ["summary", "status"],
      resolveAuth: () => fakeAuth,
    });

    expect((captured.body as { fields: string[] }).fields).toEqual(["summary", "status"]);
  });

  test("defaults fields to summary/description/status when not supplied", async () => {
    const captured: { body: unknown } = { body: null };
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      captured.body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await searchJiraIssues({
      jql: "project = ENG",
      resolveAuth: () => fakeAuth,
    });

    expect((captured.body as { fields: string[] }).fields).toEqual([
      "summary",
      "description",
      "status",
    ]);
  });

  test("treats empty fields array as 'use default trio'", async () => {
    const captured: { body: unknown } = { body: null };
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      captured.body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await searchJiraIssues({
      jql: "project = ENG",
      fields: [],
      resolveAuth: () => fakeAuth,
    });

    expect((captured.body as { fields: string[] }).fields).toEqual([
      "summary",
      "description",
      "status",
    ]);
  });

  test("passes ['*all'] through to request server-side all-fields", async () => {
    const captured: { body: unknown } = { body: null };
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      captured.body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await searchJiraIssues({
      jql: "project = ENG",
      fields: ["*all"],
      resolveAuth: () => fakeAuth,
    });

    expect((captured.body as { fields: string[] }).fields).toEqual(["*all"]);
  });

  test("throws SmithError(usage-error) when resolver returns null", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await searchJiraIssues({ jql: "project = ENG", resolveAuth: () => null });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("usage-error");
    expect((caught as SmithError).message).toContain("Atlassian credentials not configured");
  });

  test("respects SMITH_ATLASSIAN_BASE_URL env override", async () => {
    const captured: { url: string | null } = { url: null };
    globalThis.fetch = mock(async (url: string) => {
      captured.url = url;
      return new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await searchJiraIssues({
      jql: "project = ENG",
      resolveAuth: () => fakeAuth,
      env: { SMITH_ATLASSIAN_BASE_URL: "https://example.atlassian.net" },
    });

    expect(captured.url).toBe("https://example.atlassian.net/rest/api/3/search/jql");
  });
});

describe("searchJiraIssues: pagination", () => {
  test("follows nextPageToken across multiple pages", async () => {
    let calls = 0;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const reqBody = JSON.parse(init!.body as string);
      if (calls === 1) {
        expect(reqBody.nextPageToken).toBeUndefined();
        return new Response(
          JSON.stringify({
            issues: [
              { key: "ENG-1", fields: { summary: "a" } },
              { key: "ENG-2", fields: { summary: "b" } },
            ],
            nextPageToken: "tok-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (calls === 2) {
        expect(reqBody.nextPageToken).toBe("tok-2");
        return new Response(
          JSON.stringify({
            issues: [{ key: "ENG-3", fields: { summary: "c" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("unexpected extra call");
    }) as unknown as typeof fetch;

    const result = await searchJiraIssues({
      jql: "project = ENG",
      maxResults: 500,
      resolveAuth: () => fakeAuth,
    });

    expect(calls).toBe(2);
    expect(result.map((a) => a.filename)).toEqual(["ENG-1.md", "ENG-2.md", "ENG-3.md"]);
  });

  test("stops paginating once maxResults is reached", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          issues: Array.from({ length: 100 }, (_, i) => ({
            key: `ENG-${calls}-${i}`,
            fields: { summary: `s${i}` },
          })),
          nextPageToken: `tok-${calls + 1}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await searchJiraIssues({
      jql: "project = ENG",
      maxResults: 150,
      resolveAuth: () => fakeAuth,
    });

    expect(result).toHaveLength(150);
    expect(calls).toBe(2);
  });
});

describe("searchJiraIssues: 429 retry", () => {
  test("400 throws SmithError(http-error, service: Jira)", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ errorMessages: ["Invalid JQL: bad syntax"] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await searchJiraIssues({ jql: "BAD", resolveAuth: () => fakeAuth });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("http-error");
    if (payload.code === "http-error") {
      expect(payload.service).toBe("Jira");
      expect(payload.status).toBe(400);
      expect(payload.snippet).toContain("Invalid JQL");
    }
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
        JSON.stringify({ issues: [{ key: "ENG-7", fields: { summary: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await searchJiraIssues({
      jql: "project = ENG",
      resolveAuth: () => fakeAuth,
    });
    expect(calls).toBe(2);
    expect(result).toHaveLength(1);
  });

  test("caps Retry-After wait at 30s when server returns absurd value", async () => {
    let calls = 0;
    let waited = 0;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      waited = ms;
      return realSetTimeout(fn, 0);
    }) as typeof globalThis.setTimeout;
    try {
      globalThis.fetch = mock(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "86400" },
          });
        }
        return new Response(
          JSON.stringify({ issues: [{ key: "ENG-9", fields: { summary: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      await searchJiraIssues({ jql: "project = ENG", resolveAuth: () => fakeAuth });
      // Retry-After is capped at 30s base, then jittered to [15000, 45000).
      expect(waited).toBeGreaterThanOrEqual(15_000);
      expect(waited).toBeLessThan(45_000);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

describe("searchJiraIssues: workspace URL not configured (rc.4)", () => {
  test("throws SmithError(usage-error) when no SMITH_ATLASSIAN_BASE_URL is set", async () => {
    delete process.env.SMITH_ATLASSIAN_BASE_URL;
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called when baseUrl is missing");
    }) as unknown as typeof fetch;
    let caught: unknown;
    try {
      await searchJiraIssues({
        jql: "project = ENG",
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
  });
});
