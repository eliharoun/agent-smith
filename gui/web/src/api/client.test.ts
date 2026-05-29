import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, captureToken, getToken } from "./client";

const originalFetch = global.fetch;

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("captureToken", () => {
  it("reads ?token=xyz from URL and stores it", () => {
    history.replaceState({}, "", "/?token=abc123");
    captureToken();
    expect(getToken()).toBe("abc123");
    expect(window.location.search).toBe("");
  });

  it("no-op when URL has no token", () => {
    history.replaceState({}, "", "/");
    captureToken();
    expect(getToken()).toBeNull();
  });
});

describe("apiFetch", () => {
  it("attaches Bearer token header", async () => {
    sessionStorage.setItem("smith.gui.token", "tkn");
    const spy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    global.fetch = spy as unknown as typeof fetch;
    await apiFetch("/api/agents");
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get("authorization")).toBe("Bearer tkn");
  });

  it("throws on non-2xx with error envelope", async () => {
    sessionStorage.setItem("smith.gui.token", "tkn");
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "nope", code: "BAD" }), { status: 400 }),
      ) as unknown as typeof fetch;
    await expect(apiFetch("/api/agents")).rejects.toThrow(/nope/);
  });
});
