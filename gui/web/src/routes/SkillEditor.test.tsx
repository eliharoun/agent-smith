import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillEditor } from "./SkillEditor";

type FetchMock = (input: RequestInfo | URL) => Promise<Response>;

function mockFetch(routes: Record<string, { status: number; body: unknown }>): FetchMock {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, { status, body }] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

function renderRoute(name: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/skills/${name}`]}>
        <Routes>
          <Route path="/skills/:name" element={<SkillEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function skillBody(
  overrides: Partial<{
    remote: {
      url: string;
      ref?: string;
      lastPulledSha?: string;
      lastRemoteSha?: string;
    };
  }> = {},
) {
  const base: Record<string, unknown> = {
    name: "tdd",
    catalogLabel: "example-pack",
    path: "/x",
    frontmatter: { name: "tdd", description: "Test-driven dev" },
    body: "# TDD\n\nRed-green-refactor.",
    resources: [],
    installedOn: [],
  };
  if (overrides.remote) base.remote = overrides.remote;
  return base;
}

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("SkillEditor route", () => {
  it("renders frontmatter, body excerpt, resources, and install matrix on load", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills/tdd": {
          status: 200,
          body: {
            name: "tdd",
            catalogLabel: "example-pack",
            path: "/x",
            frontmatter: { name: "tdd", description: "Test-driven dev" },
            body: "# TDD\n\nRed-green-refactor.",
            resources: [{ relPath: "refs/style.md", isDirectory: false, bytes: 99 }],
            installedOn: ["opencode"],
          },
        },
      }),
    ) as unknown as typeof fetch;
    renderRoute("tdd");
    await waitFor(() => expect(screen.getAllByText("tdd").length).toBeGreaterThan(0));
    expect(screen.getByText("Test-driven dev")).toBeInTheDocument();
    expect(screen.getByText("// install matrix")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /tdd · opencode/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows not-found state when API returns 404", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills/missing": {
          status: 404,
          body: { code: "NOT_FOUND", message: "no such skill" },
        },
      }),
    ) as unknown as typeof fetch;
    renderRoute("missing");
    await waitFor(() =>
      expect(screen.getByText(/no skill named "missing" found/i)).toBeInTheDocument(),
    );
  });
});

describe("SkillEditor remote chip + Sync now (C4.9.2)", () => {
  it("renders no chip and no Sync button for a local skill", async () => {
    global.fetch = vi.fn(
      mockFetch({ "/api/skills/tdd": { status: 200, body: skillBody() } }),
    ) as unknown as typeof fetch;
    renderRoute("tdd");
    await waitFor(() => expect(screen.getAllByText("tdd").length).toBeGreaterThan(0));
    expect(screen.queryByText(/↻ synced|↑ update available/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /sync now|up to date/i })).toBeNull();
  });

  it("renders SYNCED chip and disabled 'up to date' button when in sync", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills/tdd": {
          status: 200,
          body: skillBody({
            remote: { url: "https://x/y/z.git", ref: "main" },
          }),
        },
      }),
    ) as unknown as typeof fetch;
    renderRoute("tdd");
    await waitFor(() => expect(screen.getByText(/↻ synced/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /up to date/i })).toBeDisabled();
  });

  it("renders UPDATE AVAILABLE chip and enabled Sync now button when behind", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills/tdd": {
          status: 200,
          body: skillBody({
            remote: {
              url: "https://x/y/z.git",
              ref: "main",
              lastPulledSha: "a".repeat(40),
              lastRemoteSha: "b".repeat(40),
            },
          }),
        },
      }),
    ) as unknown as typeof fetch;
    renderRoute("tdd");
    await waitFor(() => expect(screen.getByText(/↑ update available/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
  });

  it("opens RemoteSyncConfirm dialog when Sync now is clicked", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills/tdd": {
          status: 200,
          body: skillBody({
            remote: {
              url: "https://x/y/z.git",
              ref: "main",
              lastPulledSha: "a".repeat(40),
              lastRemoteSha: "b".repeat(40),
            },
          }),
        },
      }),
    ) as unknown as typeof fetch;
    renderRoute("tdd");
    await waitFor(() => expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
