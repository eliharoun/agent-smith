import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDiscoverFromUrl } from "./useDiscoverFromUrl";

const okPayload = {
  kind: "skill",
  bundles: [{ name: "a", description: "d", alreadyInstalled: false }],
  detectedTargets: ["opencode"],
  catalog: { suggestedLabel: "o/r", rootPath: "/x" },
  existingCatalog: null,
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  sessionStorage.setItem("smith.gui.token", "tok123");
});

afterEach(() => {
  global.fetch = originalFetch;
  sessionStorage.clear();
});

describe("useDiscoverFromUrl", () => {
  test("discover sends the Authorization bearer token via apiFetch", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => okPayload,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("skill"));
    await act(async () => {
      await result.current.discover("https://github.com/o/r");
    });
    await waitFor(() => expect(result.current.status).toBe("select"));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const headers = new Headers(calls[0]![1].headers);
    expect(headers.get("authorization")).toBe("Bearer tok123");
  });

  test("surfaces error message from non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "auth required", code: "git-clone-failed" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("skill"));
    await act(async () => {
      await result.current.discover("https://github.com/o/r");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("auth required");
  });

  test("rejects file:// URLs client-side without hitting the network", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("agent"));
    await act(async () => {
      await result.current.discover("file:///tmp/bare.git");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/file:\/\//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("agent local-dir path routes to /api/agents/discover-from-dir", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...okPayload, kind: "agent" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("agent"));
    await act(async () => {
      await result.current.discover("/tmp/my-agent");
    });
    await waitFor(() => expect(result.current.status).toBe("select"));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/api/agents/discover-from-dir");
    const body = JSON.parse(calls[0]![1].body as string);
    expect(body).toEqual({ path: "/tmp/my-agent" });
  });

  test("skill local-dir path routes to /api/skills/discover-from-dir", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => okPayload,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("skill"));
    await act(async () => {
      await result.current.discover("/tmp/my-skills");
    });
    await waitFor(() => expect(result.current.status).toBe("select"));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/api/skills/discover-from-dir");
    const body = JSON.parse(calls[0]![1].body as string);
    expect(body).toEqual({ path: "/tmp/my-skills" });
  });

  test("skill git URL still routes to /api/skills/discover-from-url", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => okPayload,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDiscoverFromUrl("skill"));
    await act(async () => {
      await result.current.discover("https://github.com/o/r");
    });
    await waitFor(() => expect(result.current.status).toBe("select"));

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/api/skills/discover-from-url");
    const body = JSON.parse(calls[0]![1].body as string);
    expect(body).toEqual({ url: "https://github.com/o/r", ref: undefined });
  });
});
