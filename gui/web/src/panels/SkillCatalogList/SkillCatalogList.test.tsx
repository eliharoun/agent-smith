import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCatalogList } from "./SkillCatalogList";

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Call = { url: string; init?: RequestInit | undefined };

function mockFetch(routes: Record<string, unknown>, calls: Call[]): FetchMock {
  return async (input, init) => {
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
    label: "default",
    rootPath: "/home/u/.agent-smith/skills",
    health: { exists: true, isGitRepo: false, skillCount: 7 },
  },
  {
    registryKind: "skill",
    kind: "team-shared",
    label: "example-pack",
    rootPath: "/home/u/.config/example/skills",
    protected: true,
    health: { exists: true, isGitRepo: true, skillCount: 12 },
  },
];

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("SkillCatalogList", () => {
  it("renders one row per skill catalog with label, kind, root, skill count", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    expect(screen.getByText("example-pack")).toBeInTheDocument();
    expect(screen.getByText("user-global")).toBeInTheDocument();
    expect(screen.getByText("team-shared")).toBeInTheDocument(); // the kind chip
    expect(screen.getByText(/\.agent-smith\/skills/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // Hit the kind=skill query
    expect(calls.some((c) => c.url.includes("/api/catalogs") && c.url.includes("kind=skill"))).toBe(
      true,
    );
  });

  it("disables unregister + rename for protected catalogs", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/catalogs": CATALOGS }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("example-pack")).toBeInTheDocument());
    // The protected row's unregister + rename buttons are disabled.
    const protectedRow = screen.getByText("example-pack").closest("tr")!;
    const unregBtn = Array.from(protectedRow.querySelectorAll("button")).find((b) =>
      /unregister/i.test(b.textContent ?? ""),
    );
    const renameBtn = Array.from(protectedRow.querySelectorAll("button")).find((b) =>
      /rename/i.test(b.textContent ?? ""),
    );
    expect(unregBtn).toBeDefined();
    expect(renameBtn).toBeDefined();
    expect(unregBtn!.hasAttribute("disabled")).toBe(true);
    expect(renameBtn!.hasAttribute("disabled")).toBe(true);
  });

  it("clicking unregister on a non-protected catalog opens typed-token modal, and confirming POSTs skill.unregister to /api/jobs", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch(
        {
          "/api/catalogs": CATALOGS,
          "/api/jobs": { jobId: "job-99" },
        },
        calls,
      ),
    ) as unknown as typeof fetch;
    renderPanel();
    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    const defaultRow = screen.getByText("default").closest("tr")!;
    const unregBtn = Array.from(defaultRow.querySelectorAll("button")).find((b) =>
      /unregister/i.test(b.textContent ?? ""),
    )!;
    expect(unregBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(unregBtn);
    // Modal appears with the catalog label as the typed token.
    await waitFor(() =>
      expect(screen.getByText(/Unregister catalog "default"/i)).toBeInTheDocument(),
    );
    // Confirm button is disabled until token is typed.
    const confirmBtn = screen.getByRole("button", { name: /^Destroy$/i });
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    // Type the label.
    const input = screen.getByDisplayValue("");
    fireEvent.change(input, { target: { value: "default" } });
    await waitFor(() => expect(confirmBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      const jobCall = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(jobCall).toBeDefined();
      const body = JSON.parse((jobCall!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.unregister");
      expect(body.pathOrLabel).toBe("default");
    });
  });
});
