import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentEditor } from "./AgentEditor";

interface FetchMap {
  detail?: {
    identity: string;
    expertise: string;
    soul: string;
    user: string;
  };
  installed?: { agent: string; installed: Record<string, boolean> };
  remote?: {
    url: string;
    ref?: string;
    lastPulledSha?: string;
    lastRemoteSha?: string;
  };
}

function mockFetch(map: FetchMap) {
  return vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/installed-status")) {
      return Promise.resolve(
        new Response(JSON.stringify(map.installed ?? { agent: "foo", installed: {} }), {
          status: 200,
        }),
      );
    }
    if (u.match(/\/api\/agents\/[^/]+$/)) {
      const detail = map.detail ?? {
        identity: "i",
        expertise: "e",
        soul: "s",
        user: "u",
      };
      const body: Record<string, unknown> = {
        name: "foo",
        description: "test",
        catalog: "default",
        path: "/p",
        targets: [],
        ...detail,
        config: {},
      };
      if (map.remote) body.remote = map.remote;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
}

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/agents/foo"]}>
        <Routes>
          <Route path="/agents/:name" element={<AgentEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentEditor", () => {
  it("shows the installed-notice when at least one platform is installed", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({
      installed: {
        agent: "foo",
        installed: { opencode: true, "claude-code": false },
      },
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/won't propagate/i);
    });
  });

  it("does NOT show the installed-notice when no platforms are installed", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({
      installed: {
        agent: "foo",
        installed: { opencode: false, "claude-code": false },
      },
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByText("foo")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("AgentEditor remote chip + Sync now (C4.9.1)", () => {
  it("renders no chip and no Sync button for a local agent", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({}); // no remote
    renderRoute();
    await waitFor(() => expect(screen.getByText("foo")).toBeInTheDocument());
    expect(screen.queryByText(/↻ synced|↑ update available/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /sync now|up to date/i })).toBeNull();
  });

  it("renders SYNCED chip and disabled 'up to date' button when in sync", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({
      remote: { url: "https://x/y/z.git", ref: "main" },
    });
    renderRoute();
    await waitFor(() => expect(screen.getByText(/↻ synced/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /up to date/i })).toBeDisabled();
  });

  it("renders UPDATE AVAILABLE chip and enabled Sync now button when behind", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({
      remote: {
        url: "https://x/y/z.git",
        ref: "main",
        lastPulledSha: "a".repeat(40),
        lastRemoteSha: "b".repeat(40),
      },
    });
    renderRoute();
    await waitFor(() => expect(screen.getByText(/↑ update available/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
  });

  it("opens RemoteSyncConfirm dialog when Sync now is clicked", async () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = mockFetch({
      remote: {
        url: "https://x/y/z.git",
        ref: "main",
        lastPulledSha: "a".repeat(40),
        lastRemoteSha: "b".repeat(40),
      },
    });
    renderRoute();
    await waitFor(() => expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
