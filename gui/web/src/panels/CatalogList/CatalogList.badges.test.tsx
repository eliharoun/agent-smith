// gui/web/src/panels/CatalogList/CatalogList.badges.test.tsx
//
// [v1-task RC2-8] Catalog mode badges in the web UI.
//
// Test contract:
//   - Every row renders a mode chip showing "managed" or "linked".
//   - Managed catalogs (those with a remote{} block in /api/catalogs response)
//     render the green-toned chip; linked catalogs render a neutral chip.
//   - Both registryKinds (agent + skill) honour the new field.
//
// These guard the UX promise from the catalog-mode-clarity spec: the user
// can tell at a glance whether `unregister --purge-clone` will be offered
// (managed) or rejected (linked).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogList } from "./CatalogList";

function mockFetch(routes: Record<string, unknown>) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
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
    kind: "registered",
    mode: "managed",
    label: "owner/repo",
    rootPath: "/home/u/.local/state/agent-smith/remote/github.com/owner/repo",
    gitRemote: "https://github.com/owner/repo.git",
    remote: { url: "https://github.com/owner/repo.git", ref: "HEAD" },
    health: { exists: true, bundleCount: 1 },
  },
  {
    registryKind: "agent",
    kind: "user-global",
    mode: "linked",
    label: "user-global",
    rootPath: "/home/u/.config/agent-smith/agents",
    health: { exists: true, bundleCount: 4 },
  },
  {
    registryKind: "skill",
    kind: "team-shared",
    mode: "managed",
    label: "team-skills",
    rootPath: "/home/u/.local/state/agent-smith/remote/github.com/team/skills",
    gitRemote: "https://github.com/team/skills.git",
    remote: { url: "https://github.com/team/skills.git", ref: "HEAD" },
    health: { exists: true, skillCount: 7 },
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

describe("[RC2-8] CatalogList mode badges", () => {
  it("renders 'managed' chip on rows with mode=managed", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS })) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("owner/repo")).toBeInTheDocument());
    const row = screen.getByText("owner/repo").closest("[data-testid=catalog-row]");
    expect(row).not.toBeNull();
    if (row) expect(within(row as HTMLElement).getByText("managed")).toBeInTheDocument();
  });

  it("renders 'linked' chip on rows with mode=linked", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS })) as unknown as typeof fetch;
    renderPanel();
    // Wait on a unique label ("owner/repo") to know the table has rendered;
    // then locate the linked row by its data-label attribute (kind chip
    // text "user-global" collides with the label "user-global" otherwise).
    await waitFor(() => expect(screen.getByText("owner/repo")).toBeInTheDocument());
    const row = screen
      .getAllByTestId("catalog-row")
      .find((r) => r.getAttribute("data-label") === "user-global");
    expect(row).toBeDefined();
    if (row) expect(within(row).getByText("linked")).toBeInTheDocument();
  });

  it("renders mode chip for skill registryKind too", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS })) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("team-skills")).toBeInTheDocument());
    const row = screen
      .getAllByTestId("catalog-row")
      .find((r) => r.getAttribute("data-label") === "team-skills");
    expect(row).toBeDefined();
    if (row) expect(within(row).getByText("managed")).toBeInTheDocument();
  });
});
