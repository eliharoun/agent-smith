import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "./KnowledgeIndex";

type Summary = {
  agent: string;
  sourceCount: number;
  failingCount: number;
  lastRefreshAt?: string;
};

function mockFetch(summaries: Summary[]) {
  return async (input: RequestInfo | URL) => {
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
        <KnowledgeIndex />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeIndex", () => {
  it("shows empty state with link to create an agent", async () => {
    globalThis.fetch = mockFetch([]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no agents registered yet/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /create one/ })).toHaveAttribute("href", "/agents/new");
  });

  it("each row links into /agents/:name?tab=knowledge", async () => {
    globalThis.fetch = mockFetch([
      { agent: "alpha", sourceCount: 2, failingCount: 0, lastRefreshAt: "2026-05-21T00:00:00Z" },
    ]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: "alpha" });
    expect(link).toHaveAttribute("href", "/agents/alpha?tab=knowledge");
  });

  it("sorts failing first, then most-recent, then by name", async () => {
    globalThis.fetch = mockFetch([
      {
        agent: "zzz-clean",
        sourceCount: 3,
        failingCount: 0,
        lastRefreshAt: "2026-05-21T00:00:00Z",
      },
      { agent: "aaa-broken", sourceCount: 1, failingCount: 2 },
      { agent: "mmm-empty", sourceCount: 0, failingCount: 0 },
    ]) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("aaa-broken")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("aaa-broken");
    expect(items[1]?.textContent).toContain("zzz-clean");
    expect(items[2]?.textContent).toContain("mmm-empty");
  });
});
