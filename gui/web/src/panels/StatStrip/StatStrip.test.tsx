import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatStrip } from "./StatStrip";

describe("StatStrip", () => {
  it("renders counts from status + agents", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/agents"))
        return Promise.resolve(new Response(JSON.stringify([{}, {}, {}]), { status: 200 }));
      if (u.endsWith("/api/status"))
        return Promise.resolve(
          new Response(JSON.stringify({ agentCount: 3, smithVersion: "0.22.0" }), { status: 200 }),
        );
      if (u.endsWith("/api/daemon/status"))
        return Promise.resolve(
          new Response(JSON.stringify({ state: "running", pid: 1234, heartbeatAgeMs: 100 }), {
            status: 200,
          }),
        );
      return Promise.resolve(new Response("", { status: 404 }));
    }) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <StatStrip />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.getByText(/v0.22.0/)).toBeInTheDocument();
  });
});
