import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDoctor } from "./useDoctor";
import { useStatus } from "./useStatus";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("api hooks", () => {
  it("useStatus returns parsed status", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ agentCount: 2, smithVersion: "0.22.0" }), { status: 200 }),
      ) as unknown as typeof fetch;
    sessionStorage.setItem("smith.gui.token", "t");
    const { result } = renderHook(() => useStatus(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.agentCount).toBe(2);
  });

  it("useDoctor surfaces report", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "x",
          platforms: [],
          skippedPlatforms: [],
          atlassianAuth: { status: "configured", source: "env-smith" },
          exitCode: 0,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    sessionStorage.setItem("smith.gui.token", "t");
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data && "exitCode" in data ? data.exitCode : -1).toBe(0);
  });
});
