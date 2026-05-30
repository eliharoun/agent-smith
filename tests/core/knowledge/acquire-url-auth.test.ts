// tests/core/knowledge/acquire-url-auth.test.ts
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireUrl } from "../../../src/core/knowledge/acquire";
import type { AtlassianAuth } from "../../../src/io/atlassian-auth";

let cacheDir: string;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "acquire-url-auth-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

describe("acquireUrl: auth header injection", () => {
  test("does NOT send Authorization header when opts omitted", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    await acquireUrl("https://example.com/x", cacheDir);

    const h = capturedHeaders as Record<string, string> | undefined;
    expect(h?.["Authorization"] ?? h?.["authorization"]).toBeUndefined();
  });

  test("does NOT send Authorization header when auth='none'", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;

    await acquireUrl("https://example.com/x", cacheDir, { auth: "none" });

    const h = capturedHeaders as Record<string, string> | undefined;
    expect(h?.["Authorization"] ?? h?.["authorization"]).toBeUndefined();
  });

  test("sends Basic Authorization header when auth='atlassian' and creds resolved", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;

    const fakeAuth: AtlassianAuth = {
      email: "alice@x",
      token: "tok-A",
      source: "file-smith",
    };

    await acquireUrl("https://acme.atlassian.net/wiki/x", cacheDir, {
      auth: "atlassian",
      resolveAuth: () => fakeAuth,
    });

    const h = capturedHeaders as Record<string, string>;
    const expected = `Basic ${Buffer.from("alice@x:tok-A").toString("base64")}`;
    expect(h["Authorization"] ?? h["authorization"]).toBe(expected);
  });

  test("throws with remediation when auth='atlassian' and resolver returns null", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    await expect(
      acquireUrl("https://acme.atlassian.net/wiki/x", cacheDir, {
        auth: "atlassian",
        resolveAuth: () => null,
      }),
    ).rejects.toThrow(/Atlassian credentials not configured/);
  });

  test("preserves existing If-None-Match / If-Modified-Since cache headers alongside Authorization", async () => {
    // First call: populate cache
    globalThis.fetch = mock(async () => {
      return new Response("body1", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          etag: '"abc"',
          "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
        },
      });
    }) as unknown as typeof fetch;

    const fakeAuth: AtlassianAuth = { email: "a@x", token: "t", source: "env-smith" };
    await acquireUrl("https://acme.atlassian.net/x", cacheDir, {
      auth: "atlassian",
      resolveAuth: () => fakeAuth,
    });

    // Second call: should send Authorization + If-None-Match + If-Modified-Since
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("body1", {
        status: 304,
        headers: { etag: '"abc"' },
      });
    }) as unknown as typeof fetch;

    await acquireUrl("https://acme.atlassian.net/x", cacheDir, {
      auth: "atlassian",
      resolveAuth: () => fakeAuth,
    });

    expect(capturedHeaders?.["Authorization"] ?? capturedHeaders?.["authorization"]).toBeDefined();
    expect(capturedHeaders?.["if-none-match"]).toBe('"abc"');
    expect(capturedHeaders?.["if-modified-since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });
});
