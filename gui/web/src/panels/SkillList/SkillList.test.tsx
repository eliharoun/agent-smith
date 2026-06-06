import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { SkillList } from "./SkillList";

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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationCenter>
        <MemoryRouter>
          <SkillList />
        </MemoryRouter>
      </NotificationCenter>
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

describe("SkillList", () => {
  it("renders empty state with register link when no skills", async () => {
    global.fetch = vi.fn(
      mockFetch({ "/api/skills": [], "/api/installed-skills": [] }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no skills registered yet/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /register a catalog/i })).toHaveAttribute(
      "href",
      "/skills/new",
    );
  });

  it("renders skills grouped by catalog and links to /skills/:name", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills": [
          { name: "tdd", description: "Test-driven dev", catalogLabel: "example-pack", path: "/x" },
          {
            name: "brainstorm",
            description: "Explore intent",
            catalogLabel: "example-pack",
            path: "/y",
          },
          { name: "mine", description: "Private skill", catalogLabel: "default", path: "/z" },
        ],
        "/api/installed-skills": [],
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("tdd")).toBeInTheDocument());
    expect(screen.getByText("brainstorm")).toBeInTheDocument();
    expect(screen.getByText("mine")).toBeInTheDocument();
    // group headers
    expect(screen.getByText(/example-pack/)).toBeInTheDocument();
    expect(screen.getByText(/default/)).toBeInTheDocument();
    // link href
    expect(screen.getByRole("link", { name: /tdd/i })).toHaveAttribute("href", "/skills/tdd");
  });

  it("tones chips green for platforms where the skill is installed", async () => {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills": [
          { name: "tdd", description: "TDD", catalogLabel: "example-pack", path: "/x" },
        ],
        "/api/installed-skills": [
          {
            name: "tdd",
            sourceCatalogLabel: "example-pack",
            sourcePath: "/x",
            installedPaths: { opencode: "/oc/tdd", claudeCode: "/cc/tdd" },
            contentHash: "abc",
            installedAt: "2026-05-21T00:00:00Z",
          },
        ],
      }),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("opencode")).toBeInTheDocument());
    expect(screen.getByText("opencode").className).toMatch(/text-matrix-green\b/);
    expect(screen.getByText("claude-code").className).toMatch(/text-matrix-green\b/);
    // codex was not installed
    expect(screen.getByText("codex").className).not.toMatch(/text-matrix-green\b/);
  });
});

describe("SkillList filter + collapse", () => {
  function mountThreeSkills() {
    global.fetch = vi.fn(
      mockFetch({
        "/api/skills": [
          { name: "tdd", description: "Test-driven dev", catalogLabel: "example-pack", path: "/x" },
          {
            name: "brainstorm",
            description: "Explore intent",
            catalogLabel: "example-pack",
            path: "/y",
          },
          {
            name: "foo-skill",
            description: "does foo things",
            catalogLabel: "default",
            path: "/z",
          },
        ],
        "/api/installed-skills": [],
      }),
    ) as unknown as typeof fetch;
    return renderPanel();
  }

  it("filter input narrows visible rows by name and description", async () => {
    mountThreeSkills();
    await waitFor(() => expect(screen.getByText("tdd")).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/filter/i);

    // Match by name
    fireEvent.change(input, { target: { value: "foo" } });
    await waitFor(() => expect(screen.queryByText("tdd")).toBeNull());
    expect(screen.queryByText("brainstorm")).toBeNull();
    expect(screen.getByText("foo-skill")).toBeInTheDocument();

    // Match by description ("Explore intent" contains "intent")
    fireEvent.change(input, { target: { value: "intent" } });
    await waitFor(() => expect(screen.getByText("brainstorm")).toBeInTheDocument());
    expect(screen.queryByText("tdd")).toBeNull();
    expect(screen.queryByText("foo-skill")).toBeNull();
  });

  it("catalog group can be collapsed and state persists in localStorage", async () => {
    mountThreeSkills();
    await waitFor(() => expect(screen.getByText("tdd")).toBeInTheDocument());

    // The example-pack group header is a button containing the label
    const headers = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.toLowerCase().includes("example-pack"));
    expect(headers.length).toBeGreaterThan(0);
    fireEvent.click(headers[0]!);

    await waitFor(() => expect(screen.queryByText("tdd")).toBeNull());
    expect(screen.queryByText("brainstorm")).toBeNull();
    // default group still visible
    expect(screen.getByText("foo-skill")).toBeInTheDocument();

    // Persistence check
    expect(localStorage.getItem("skills:example-pack:open")).toBe("0");
  });

  it("description column starts at same x-coordinate across rows", async () => {
    mountThreeSkills();
    await waitFor(() => expect(screen.getByText("tdd")).toBeInTheDocument());

    // Grab each ListRow (<li>) and assert they share the same grid-template-columns
    const rows = document.querySelectorAll("li[style*='grid-template-columns']");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const templates = new Set<string>();
    rows.forEach((r) => {
      templates.add((r as HTMLElement).style.gridTemplateColumns);
    });
    expect(templates.size).toBe(1);
    // And the template must be the planned one
    expect([...templates][0]).toContain("minmax(14rem,18rem)");
  });
});

// ── C4.7.3: RemoteBadge integration ──

describe("SkillList RemoteBadge integration (C4.7.3)", () => {
  const SHA_A = "a".repeat(40);
  const SHA_B = "b".repeat(40);

  function mountWithRemoteStates() {
    global.fetch = vi.fn(
      mockFetch({
        "/api/installed-skills": [],
        "/api/skills": [
          {
            name: "local-skill",
            description: "local only",
            catalogLabel: "default",
            path: "/a",
          },
          {
            name: "synced-skill",
            description: "in sync",
            catalogLabel: "default",
            path: "/b",
            remote: { url: "https://x/y/z.git", ref: "main", lastPulledSha: SHA_A },
          },
          {
            name: "behind-skill",
            description: "has update",
            catalogLabel: "default",
            path: "/c",
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
    return renderPanel();
  }

  it("renders RemoteBadge per row with correct state", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("local-skill")).toBeInTheDocument());
    const local = screen.getByText("local-skill").closest("li");
    const synced = screen.getByText("synced-skill").closest("li");
    const behind = screen.getByText("behind-skill").closest("li");
    expect(within(local as HTMLElement).queryByText(/↻ synced|update available/i)).toBeNull();
    expect(within(synced as HTMLElement).getByText(/↻ synced/i)).toBeInTheDocument();
    expect(within(behind as HTMLElement).getByText(/update available/i)).toBeInTheDocument();
  });

  it("opens RemoteSyncConfirm when behind badge clicked", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-skill")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/update available/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/sync behind-skill from/i)).toBeInTheDocument();
  });

  it("applies faint amber row tint on behind rows", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-skill")).toBeInTheDocument());
    const behind = screen.getByText("behind-skill").closest("li");
    const local = screen.getByText("local-skill").closest("li");
    expect((behind as HTMLElement).className).toMatch(/bg-matrix-amber/);
    expect((local as HTMLElement).className).not.toMatch(/bg-matrix-amber/);
  });

  it("cancel button closes the sync confirm dialog", async () => {
    mountWithRemoteStates();
    await waitFor(() => expect(screen.getByText("behind-skill")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/update available/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
