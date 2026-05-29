import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentList } from "./AgentList";

type FetchMock = (input: RequestInfo | URL) => Promise<Response>;

function mockFetch(routes: Record<string, unknown>): FetchMock {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("AgentList", () => {
  it("renders agent rows", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {},
        "/api/agents": [
          {
            name: "foo",
            description: "Does foo",
            catalog: "default",
            path: "/x",
            targets: ["opencode"],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    renderList();
    await waitFor(() => expect(screen.getByText("foo")).toBeInTheDocument());
    expect(screen.getByText(/Does foo/)).toBeInTheDocument();
  });

  it("renders empty state", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {},
        "/api/agents": [],
      }),
    ) as unknown as typeof fetch;
    renderList();
    await waitFor(() => expect(screen.getByText(/No agents yet/i)).toBeInTheDocument());
  });

  it("tones chips green for platforms where the agent is installed", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {
          foo: { agent: "foo", installed: { opencode: true, "claude-code": true } },
        },
        "/api/agents": [
          {
            name: "foo",
            description: "Does foo",
            catalog: "default",
            path: "/x",
            targets: ["opencode", "claude-code"],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    renderList();
    await waitFor(() => expect(screen.getByText("opencode")).toBeInTheDocument());
    await waitFor(() => {
      const oc = screen.getByText("opencode");
      expect(oc.className).toMatch(/text-matrix-green\b/);
    });
    const cc = screen.getByText("claude-code");
    expect(cc.className).toMatch(/text-matrix-green\b/);
  });

  it("tones chips by per-platform install state", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {
          foo: { agent: "foo", installed: { opencode: true, codex: false } },
        },
        "/api/agents": [
          {
            name: "foo",
            description: "Does foo",
            catalog: "default",
            path: "/x",
            targets: ["opencode", "codex"],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    renderList();
    await waitFor(() => expect(screen.getByText("opencode")).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getByText("opencode").className).toMatch(/text-matrix-green\b/);
    });
    const codex = screen.getByText("codex");
    expect(codex.className).not.toMatch(/text-matrix-green\b/);
    expect(codex.className).toMatch(/text-matrix-body/);
  });

  it("renders all chips in default tone when agent is installed nowhere", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {
          foo: { agent: "foo", installed: {} },
        },
        "/api/agents": [
          {
            name: "foo",
            description: "Does foo",
            catalog: "default",
            path: "/x",
            targets: ["opencode", "codex"],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    renderList();
    await waitFor(() => expect(screen.getByText("opencode")).toBeInTheDocument());
    expect(screen.getByText("opencode").className).not.toMatch(/text-matrix-green\b/);
    expect(screen.getByText("codex").className).not.toMatch(/text-matrix-green\b/);
    expect(screen.getByText("opencode").className).toMatch(/text-matrix-body/);
    expect(screen.getByText("codex").className).toMatch(/text-matrix-body/);
  });
});

describe("AgentList groups by catalog", () => {
  function mountTwoCatalogs() {
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {},
        "/api/agents": [
          {
            name: "alpha",
            description: "first agent",
            catalog: "platform-ai",
            path: "/a",
            targets: ["opencode"],
          },
          {
            name: "bravo",
            description: "second agent",
            catalog: "platform-ai",
            path: "/b",
            targets: ["opencode"],
          },
          {
            name: "charlie",
            description: "lonely thing",
            catalog: "extras",
            path: "/c",
            targets: ["codex"],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    return renderList();
  }

  it("renders one CollapsibleCatalogGroup per distinct catalog", async () => {
    mountTwoCatalogs();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    // group headers (buttons) for each catalog
    const groupButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.textContent?.toLowerCase().includes("platform-ai") ||
          b.textContent?.toLowerCase().includes("extras"),
      );
    const labels = new Set(groupButtons.map((b) => b.textContent ?? ""));
    expect([...labels].some((l) => l.includes("platform-ai"))).toBe(true);
    expect([...labels].some((l) => l.includes("extras"))).toBe(true);
  });

  it("filter input narrows across all groups", async () => {
    mountTwoCatalogs();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/filter/i);

    fireEvent.change(input, { target: { value: "lonely" } });
    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
    expect(screen.queryByText("bravo")).toBeNull();
    expect(screen.getByText("charlie")).toBeInTheDocument();
  });

  it("catalog chip filter restricts to one group", async () => {
    mountTwoCatalogs();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    // chip strip: pick the one for "extras" by data-chip attr (group headers don't have it)
    const extrasChip = document.querySelector(
      'button[data-chip="extras"]',
    ) as HTMLButtonElement | null;
    expect(extrasChip).toBeTruthy();
    fireEvent.click(extrasChip!);

    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
    expect(screen.queryByText("bravo")).toBeNull();
    expect(screen.getByText("charlie")).toBeInTheDocument();
  });

  it("description column starts at same x-coordinate across rows", async () => {
    mountTwoCatalogs();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    const rows = document.querySelectorAll("li[style*='grid-template-columns']");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const templates = new Set<string>();
    rows.forEach((r) => {
      templates.add((r as HTMLElement).style.gridTemplateColumns);
    });
    expect(templates.size).toBe(1);
    expect([...templates][0]).toContain("minmax(14rem,18rem)");
  });
});

// ── C4.7.2: RemoteBadge integration ──

describe("AgentList RemoteBadge integration (C4.7.2)", () => {
  const SHA_A = "a".repeat(40);
  const SHA_B = "b".repeat(40);

  function mountWithRemoteStates() {
    global.fetch = vi.fn(
      mockFetch({
        "/api/agents/installed-statuses": {},
        "/api/agents": [
          {
            name: "local-agent",
            description: "local only",
            catalog: "default",
            path: "/a",
            targets: ["opencode"],
          },
          {
            name: "synced-agent",
            description: "in sync",
            catalog: "default",
            path: "/b",
            targets: ["opencode"],
            remote: { url: "https://x/y/z.git", ref: "main", lastPulledSha: SHA_A },
          },
          {
            name: "behind-agent",
            description: "has update",
            catalog: "default",
            path: "/c",
            targets: ["opencode"],
            remote: {
              url: "https://x/y/z.git",
              ref: "main",
              lastPulledSha: SHA_A,
              lastRemoteSha: SHA_B,
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    return renderList();
  }

  it("renders RemoteBadge per row with correct state", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("local-agent")).toBeInTheDocument());
    const local = screen.getByText("local-agent").closest("li");
    const synced = screen.getByText("synced-agent").closest("li");
    const behind = screen.getByText("behind-agent").closest("li");
    expect(local).not.toBeNull();
    expect(synced).not.toBeNull();
    expect(behind).not.toBeNull();
    expect(within(local as HTMLElement).queryByText(/↻ synced|update available/i)).toBeNull();
    expect(within(synced as HTMLElement).getByText(/↻ synced/i)).toBeInTheDocument();
    expect(within(behind as HTMLElement).getByText(/update available/i)).toBeInTheDocument();
  });

  it("opens RemoteSyncConfirm when behind badge clicked", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-agent")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/update available/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/sync behind-agent from/i)).toBeInTheDocument();
  });

  it("applies faint amber row tint on behind rows", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-agent")).toBeInTheDocument());
    const behind = screen.getByText("behind-agent").closest("li");
    const local = screen.getByText("local-agent").closest("li");
    expect((behind as HTMLElement).className).toMatch(/bg-matrix-amber/);
    expect((local as HTMLElement).className).not.toMatch(/bg-matrix-amber/);
  });

  it("cancel button closes the sync confirm dialog", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-agent")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/update available/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
