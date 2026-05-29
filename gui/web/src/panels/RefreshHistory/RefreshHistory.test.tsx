import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { RefreshHistory } from "./RefreshHistory";

type Entry = {
  sourceId: string;
  last_refreshed_at?: string;
  last_attempt_at?: string;
  last_error?: string | null;
  etag?: string;
  last_modified?: string;
};

type Call = { url: string; init?: RequestInit | undefined };

function mockFetch(entries: Entry[], calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (url.includes("/refresh-history")) {
      return new Response(JSON.stringify({ agent: "alpha", entries }), {
        status: 200,
      });
    }
    if (url.includes("/api/jobs")) {
      return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RefreshHistory agent="alpha" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RefreshHistory", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  it("shows empty state when no entries", async () => {
    globalThis.fetch = mockFetch([], calls) as typeof fetch;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/no refresh attempts recorded yet/)).toBeInTheDocument(),
    );
  });

  it("renders failing rows with error text and red chip", async () => {
    globalThis.fetch = mockFetch(
      [
        {
          sourceId: "broken",
          last_refreshed_at: "2026-05-20T00:00:00Z",
          last_attempt_at: "2026-05-21T00:00:00Z",
          last_error: "HTTP 500",
        },
      ],
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("broken")).toBeInTheDocument());
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    expect(screen.getByText("failing")).toBeInTheDocument();
  });

  it("per-row refresh dispatches knowledge.fetch with source", async () => {
    globalThis.fetch = mockFetch(
      [
        {
          sourceId: "src-a",
          last_refreshed_at: "2026-05-21T00:00:00Z",
          last_attempt_at: "2026-05-21T00:00:00Z",
          last_error: null,
        },
      ],
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("src-a")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /refresh/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/jobs"))).toBe(true));
    const post = calls.find((c) => c.url.includes("/api/jobs"));
    const body = JSON.parse(String(post?.init?.body ?? "{}"));
    expect(body.command).toBe("knowledge.fetch");
    expect(body.agent).toBe("alpha");
    expect(body.source).toBe("src-a");
  });

  it("sorts most-recently-attempted first", async () => {
    globalThis.fetch = mockFetch(
      [
        {
          sourceId: "old",
          last_attempt_at: "2026-05-19T00:00:00Z",
          last_error: null,
        },
        {
          sourceId: "new",
          last_attempt_at: "2026-05-21T00:00:00Z",
          last_error: null,
        },
      ],
      calls,
    ) as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("new")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("new");
    expect(items[1]?.textContent).toContain("old");
  });
});
