// gui/web/src/panels/SkillCatalogList/SkillCatalogList.badges.test.tsx
//
// [v1-task RC2-8] Mode badges in the legacy SkillCatalogList panel.
// Same contract as CatalogList.badges.test.tsx (see header there).
// SkillCatalogList renders a <table>, so we locate rows by label text
// and assert the chip appears in the same row.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCatalogList } from "./SkillCatalogList";

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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SkillCatalogList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CATALOGS = [
  {
    registryKind: "skill",
    kind: "user-global",
    mode: "linked",
    label: "default",
    rootPath: "/home/u/.config/agent-smith/skills",
    health: { exists: true, skillCount: 7 },
  },
  {
    registryKind: "skill",
    kind: "team-shared",
    mode: "managed",
    label: "team-skills",
    rootPath: "/home/u/.local/state/agent-smith/remote/github.com/team/skills",
    gitRemote: "https://github.com/team/skills.git",
    remote: { url: "https://github.com/team/skills.git", ref: "HEAD" },
    health: { exists: true, skillCount: 3 },
  },
];

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("[RC2-8] SkillCatalogList mode badges", () => {
  it("shows 'linked' chip for user-global catalog", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS })) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    const row = screen.getByText("default").closest("tr");
    expect(row).not.toBeNull();
    if (row) expect(within(row).getByText("linked")).toBeInTheDocument();
  });

  it("shows 'managed' chip for cloned team catalog", async () => {
    global.fetch = vi.fn(mockFetch({ "/api/catalogs": CATALOGS })) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("team-skills")).toBeInTheDocument());
    const row = screen.getByText("team-skills").closest("tr");
    expect(row).not.toBeNull();
    if (row) expect(within(row).getByText("managed")).toBeInTheDocument();
  });
});
