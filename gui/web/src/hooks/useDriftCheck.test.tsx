import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { driftCheckKey, useDriftCheck } from "./useDriftCheck";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => sessionStorage.setItem("smith.gui.token", "t"));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrap };
}

describe("useDriftCheck", () => {
  it("returns drifted platforms from the endpoint", async () => {
    server.use(
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["claude-code", "kiro"] }),
      ),
    );
    const { Wrap } = makeWrapper();
    const { result } = renderHook(() => useDriftCheck("foo"), { wrapper: Wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.drifted).toEqual(["claude-code", "kiro"]);
    expect(result.current.error).toBeNull();
  });

  it("isLoading transitions correctly", async () => {
    server.use(
      http.get("*/api/agents/foo/drift-check", () => HttpResponse.json({ drifted: [] })),
    );
    const { Wrap } = makeWrapper();
    const { result } = renderHook(() => useDriftCheck("foo"), { wrapper: Wrap });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.drifted).toEqual([]);
  });

  it("refetches on cache invalidate", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/agents/foo/drift-check", () => {
        calls += 1;
        return HttpResponse.json({ drifted: calls === 1 ? [] : ["opencode"] });
      }),
    );
    const { qc, Wrap } = makeWrapper();
    const { result } = renderHook(() => useDriftCheck("foo"), { wrapper: Wrap });
    await waitFor(() => expect(result.current.drifted).toEqual([]));
    await qc.invalidateQueries({ queryKey: driftCheckKey("foo") });
    await waitFor(() => expect(result.current.drifted).toEqual(["opencode"]));
    expect(calls).toBe(2);
  });

  it("does not fetch when agent name is empty", () => {
    let calls = 0;
    server.use(
      http.get("*/api/agents//drift-check", () => {
        calls += 1;
        return HttpResponse.json({ drifted: [] });
      }),
    );
    const { Wrap } = makeWrapper();
    renderHook(() => useDriftCheck(""), { wrapper: Wrap });
    expect(calls).toBe(0);
  });
});
