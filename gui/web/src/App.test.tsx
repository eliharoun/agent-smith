import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the smith breadcrumb", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: "HOME",
          detectedTools: { opencode: true, claudeCode: false, codex: false },
          agentCount: 0,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("smith")).toBeInTheDocument();
  });
});
