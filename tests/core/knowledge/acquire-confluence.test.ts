import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { acquireConfluence } from "../../../src/core/knowledge/acquire";
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

describe("acquireConfluence", () => {
  test("returns AcquiredArtifact[] from confluence client", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "1",
          title: "Hello",
          body: { storage: { value: "<p>hi</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const { artifacts, warnings } = await acquireConfluence({
      space: "ENG",
      pages: [{ id: 1 }],
      format: "markdown",
      resolveAuth: () => fakeAuth,
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.filename).toBe("1-hello.md");
    expect(warnings).toEqual([]);
  });
});
