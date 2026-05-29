import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { acquireUrl } from "../../../src/core/knowledge/acquire";
import { SmithError } from "../../../src/core/smith-error";

const spies: Array<ReturnType<typeof spyOn>> = [];

function mockFetchOnce(body: string, headers: Record<string, string> = {}, status = 200) {
  const h = new Headers(headers);
  const spy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(body, { status, headers: h }) as Response,
  );
  spies.push(spy as unknown as ReturnType<typeof spyOn>);
  return spy;
}

describe("acquireUrl", () => {
  let cache: string;
  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), "smith-url-"));
  });
  afterEach(async () => {
    await rm(cache, { recursive: true, force: true });
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("fetches a URL and returns one artifact with content-type", async () => {
    mockFetchOnce("<html><body><p>hi</p></body></html>", {
      "content-type": "text/html; charset=utf-8",
    });
    const r = await acquireUrl("https://example.com/x", cache);
    expect(r).toHaveLength(1);
    expect(r[0]?.contentType).toContain("text/html");
    expect(r[0]?.bytes.toString("utf8")).toContain("hi");
  });

  it("uses etag for conditional re-fetch and returns cached body on 304", async () => {
    mockFetchOnce("first", { "content-type": "text/plain", etag: '"v1"' });
    const r1 = await acquireUrl("https://example.com/y", cache);
    expect(r1[0]?.bytes.toString("utf8")).toBe("first");

    const fetchSpy = mockFetchOnce("", { etag: '"v1"' }, 304);
    const r2 = await acquireUrl("https://example.com/y", cache);
    expect(r2[0]?.bytes.toString("utf8")).toBe("first");
    // spyOn returns the same underlying spy across calls; the conditional
    // fetch is the most recent call, not calls[0].
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const headers = lastCall?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["if-none-match"]).toBe('"v1"');
  });

  it("throws on non-2xx and non-304 status", async () => {
    mockFetchOnce("nope", {}, 500);
    await expect(acquireUrl("https://example.com/z", cache)).rejects.toThrow(/500/);
  });

  it("wraps fetch TypeError as SmithError(network-error) with redacted URL", async () => {
    const spy = spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("fetch failed: ECONNREFUSED"),
    );
    spies.push(spy as unknown as ReturnType<typeof spyOn>);

    let caught: unknown;
    try {
      await acquireUrl("https://api.example.com/v1?api_key=xxx", cache);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const err = caught as SmithError;
    expect(err.payload.code).toBe("network-error");
    if (err.payload.code !== "network-error") throw new Error("narrow");
    expect(err.payload.url).toBe(
      "https://api.example.com/v1?api_key=[redacted]",
    );
    expect(err.payload.url).not.toContain("xxx");
    expect(err.payload.operation).toBe("fetch");
    expect(err.payload.cause).toContain("ECONNREFUSED");
  });
});
