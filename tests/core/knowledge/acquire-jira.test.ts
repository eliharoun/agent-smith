import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { acquireJira } from "../../../src/core/knowledge/acquire";
import type { AtlassianAuth } from "../../../src/io/atlassian-auth";

const fakeAuth: AtlassianAuth = { email: "a@x", token: "t", source: "file-smith" };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.SMITH_ATLASSIAN_BASE_URL = "https://example.atlassian.net";
});

afterEach(() => {
  delete process.env.SMITH_ATLASSIAN_BASE_URL;
  globalThis.fetch = originalFetch;
});

describe("acquireJira", () => {
  test("returns AcquiredArtifact[] from jira client", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          issues: [{ key: "ENG-1", fields: { summary: "x" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const artifacts = await acquireJira({
      jql: "project = ENG",
      resolveAuth: () => fakeAuth,
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.filename).toBe("ENG-1.md");
  });
});
