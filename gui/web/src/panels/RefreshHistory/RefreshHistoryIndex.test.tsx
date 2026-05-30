import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { RefreshHistoryIndex } from "./RefreshHistoryIndex";

type Summary = {
  agent: string;
  sourceCount: number;
  failingCount: number;
  lastRefreshAt?: string;
};

function mockFetch(summaries: Summary[]) {
  return async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/knowledge/refresh-summary")) {
      return new Response(JSON.stringify({ summaries }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RefreshHistoryIndex />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RefreshHistoryIndex", () => {
  beforeEach(() => {
    // reset
  });

  it("shows empty state when no agents", async () => {
    globalThis.fetch = mockFetch([]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no agents registered yet/)).toBeInTheDocument());
  });

  it("sorts failing agents first, then by lastRefreshAt desc, then by name", async () => {
    globalThis.fetch = mockFetch([
      {
        agent: "alpha",
        sourceCount: 2,
        failingCount: 0,
        lastRefreshAt: "2026-05-21T00:00:00Z",
      },
      {
        agent: "bravo",
        sourceCount: 1,
        failingCount: 1,
        lastRefreshAt: "2026-05-20T00:00:00Z",
      },
      { agent: "charlie", sourceCount: 0, failingCount: 0 },
    ]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("bravo")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    // Order: failing (bravo) → alpha (most recent) → charlie (no refresh)
    expect(items[0]?.textContent).toContain("bravo");
    expect(items[1]?.textContent).toContain("alpha");
    expect(items[2]?.textContent).toContain("charlie");
  });

  it("renders failing chip with count and empty chip for zero-source agents", async () => {
    globalThis.fetch = mockFetch([
      { agent: "fail-svc", sourceCount: 3, failingCount: 2 },
      { agent: "empty-svc", sourceCount: 0, failingCount: 0 },
    ]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("2 failing")).toBeInTheDocument());
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
