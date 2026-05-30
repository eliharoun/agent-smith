import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogList } from "./CatalogList";

type Call = { url: string; init?: RequestInit | undefined };
function mockFetch(routes: Record<string, unknown>, calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

const CATALOGS = [
  {
    registryKind: "agent",
    kind: "user-global",
    label: "default-agents",
    rootPath: "/a/agents",
    health: { exists: true, bundleCount: 4 },
  },
  {
    registryKind: "skill",
    kind: "user-global",
    label: "default-skills",
    rootPath: "/a/skills",
    health: { exists: true, skillCount: 7 },
  },
  {
    registryKind: "skill",
    kind: "team-shared",
    label: "example-pack",
    rootPath: "/r/skills",
    protected: true,
    health: { exists: true, skillCount: 12 },
  },
];

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CatalogList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("CatalogList", () => {
  it("renders agent + skill rows with kind chips and health badges", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-agents")).toBeInTheDocument());
    expect(screen.getByText("default-skills")).toBeInTheDocument();
    expect(screen.getByText("example-pack")).toBeInTheDocument();
    // Default filter = all → no kind query param.
    expect(calls.some((c) => c.url.includes("/api/catalogs") && !c.url.includes("kind="))).toBe(
      true,
    );
  });

  it("filters to skill only when 'skill' chip is clicked", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-agents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^skill$/ }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("kind=skill"))).toBe(true);
    });
  });

  it("disables both buttons on protected catalogs", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("example-pack")).toBeInTheDocument());
    const row = document.querySelector('[data-testid="catalog-row"][data-label="example-pack"]')!;
    const buttons = Array.from(row.querySelectorAll("button"));
    expect(buttons.find((b) => /rename/i.test(b.textContent ?? ""))!.hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      buttons.find((b) => /unregister/i.test(b.textContent ?? ""))!.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("disables rename on skill rows (CLI does not yet support rename)", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS }, [])) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-skills")).toBeInTheDocument());
    const row = document.querySelector('[data-testid="catalog-row"][data-label="default-skills"]')!;
    const renameBtn = Array.from(row.querySelectorAll("button")).find((b) =>
      /rename/i.test(b.textContent ?? ""),
    )!;
    expect(renameBtn.hasAttribute("disabled")).toBe(true);
  });

  it("agent unregister: POSTs agent.unregister with pathOrLabel=label", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS, "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-agents")).toBeInTheDocument());
    const row = document.querySelector('[data-testid="catalog-row"][data-label="default-agents"]')!;
    const unreg = Array.from(row.querySelectorAll("button")).find((b) =>
      /unregister/i.test(b.textContent ?? ""),
    )!;
    fireEvent.click(unreg);
    const input = screen.getByDisplayValue("");
    fireEvent.change(input, { target: { value: "default-agents" } });
    fireEvent.click(screen.getByRole("button", { name: /^Destroy$/i }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("agent.unregister");
      expect(body.pathOrLabel).toBe("default-agents");
    });
  });

  it("skill unregister: POSTs skill.unregister", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS, "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-skills")).toBeInTheDocument());
    const row = document.querySelector('[data-testid="catalog-row"][data-label="default-skills"]')!;
    const unreg = Array.from(row.querySelectorAll("button")).find((b) =>
      /unregister/i.test(b.textContent ?? ""),
    )!;
    fireEvent.click(unreg);
    const input = screen.getByDisplayValue("");
    fireEvent.change(input, { target: { value: "default-skills" } });
    fireEvent.click(screen.getByRole("button", { name: /^Destroy$/i }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.unregister");
      expect(body.pathOrLabel).toBe("default-skills");
    });
  });

  it("agent rename: opens modal, validates non-empty + different, then POSTs agent.catalog-rename", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS, "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-agents")).toBeInTheDocument());
    const row = document.querySelector('[data-testid="catalog-row"][data-label="default-agents"]')!;
    const renameBtn = Array.from(row.querySelectorAll("button")).find((b) =>
      /rename/i.test(b.textContent ?? ""),
    )!;
    fireEvent.click(renameBtn);
    // Modal open: current label readonly + new label editable, both initially "default-agents".
    expect(screen.getAllByDisplayValue("default-agents")).toHaveLength(2);
    // Rename button disabled when newLabel equals oldLabel
    const renameSubmit = screen.getByRole("button", { name: /^Rename$/ });
    expect(renameSubmit.hasAttribute("disabled")).toBe(true);
    const newInput = screen.getAllByDisplayValue("default-agents")[1]!;
    fireEvent.change(newInput, { target: { value: "renamed-default" } });
    await waitFor(() => expect(renameSubmit.hasAttribute("disabled")).toBe(false));
    fireEvent.click(renameSubmit);
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("agent.catalog-rename");
      expect(body.oldLabel).toBe("default-agents");
      expect(body.newLabel).toBe("renamed-default");
    });
  });
});

describe("CatalogList responsive grid", () => {
  const LONG_PATH =
    "/very/long/absolute/path/to/some/deeply/nested/catalog/directory/that/will/definitely/truncate";

  it("truncated cells have title tooltip with full text", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch(
        {
          "/api/catalogs": [
            {
              registryKind: "agent",
              kind: "user-global",
              label: "long-path-cat",
              rootPath: LONG_PATH,
              gitRemote: "git@github.com:org/some-extremely-long-repository-name.git",
              health: { exists: true, bundleCount: 1 },
            },
          ],
        },
        calls,
      ),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("long-path-cat")).toBeInTheDocument());
    const rootCell = screen.getByText(LONG_PATH);
    expect(rootCell.title).toBe(LONG_PATH);
    expect(rootCell.className).toContain("truncate");
  });

  // [v1-task RC2 GUI bug-fix] Header columns drifted out of alignment
  // with row content because the header and each row were independent
  // CSS grids; an `auto` column (the kind+mode chip cell) sized to
  // content in each grid independently, so header text "kind" sat at a
  // different x than the row chips, and every subsequent column
  // inherited the offset.
  //
  // The fix is a single outer CSS grid that owns the column track. Both
  // the header and every row are wrapped with `display: contents` so
  // their cells become direct grid items of the same parent grid,
  // sharing one column-track resolution. This test asserts the
  // structural invariant: the literal header label "label" and the
  // first row's label text MUST share the same grid parent.
  it("header and row cells share a single grid container", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS }, [])) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default-agents")).toBeInTheDocument());

    const headerLabel = screen.getByText("label");
    const firstRow = document.querySelector(
      '[data-testid="catalog-row"][data-label="default-agents"]',
    ) as HTMLElement;
    expect(firstRow).toBeTruthy();
    const rowLabelCell = firstRow.querySelector("span") as HTMLElement;
    expect(rowLabelCell).toBeTruthy();

    // Both the header text wrapper and the row label cell must roll up
    // to the same grid-display ancestor. Walk up from each looking for
    // the nearest element whose computed `display` is `grid`; in jsdom
    // we can't compute styles, so we check the class names instead.
    const findGridAncestor = (el: HTMLElement | null): HTMLElement | null => {
      let cur: HTMLElement | null = el;
      while (cur) {
        if (cur.className && /\bgrid\b/.test(cur.className) && !/contents/.test(cur.className)) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    };
    const headerGrid = findGridAncestor(headerLabel);
    const rowGrid = findGridAncestor(rowLabelCell);
    expect(headerGrid).not.toBeNull();
    expect(rowGrid).not.toBeNull();
    expect(headerGrid).toBe(rowGrid);
  });
});
