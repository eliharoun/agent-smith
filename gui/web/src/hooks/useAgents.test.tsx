import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAgents } from "./useAgents";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useAgents", () => {
  it("returns the fetched list", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { name: "foo", description: "d", catalog: "default", path: "/x", targets: [] },
          ]),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    sessionStorage.setItem("smith.gui.token", "t");
    const { result } = renderHook(() => useAgents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.name).toBe("foo");
  });
});
