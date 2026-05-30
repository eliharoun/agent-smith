import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillInstallMatrix } from "./SkillInstallMatrix";

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

function renderPanel(props: {
  name: string;
  installedOn: ("opencode" | "claude-code" | "codex")[];
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SkillInstallMatrix {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("SkillInstallMatrix", () => {
  it("reflects installedOn as initial toggle state", () => {
    renderPanel({ name: "tdd", installedOn: ["opencode"] });
    expect(screen.getByRole("switch", { name: /tdd · opencode/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: /tdd · codex/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("Apply disabled when no changes pending", () => {
    renderPanel({ name: "tdd", installedOn: ["opencode"] });
    expect(screen.getByRole("button", { name: /apply changes/i })).toHaveAttribute("disabled");
  });

  it("install: POSTs skill.install with selected targets", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel({ name: "tdd", installedOn: [] });
    fireEvent.click(screen.getByRole("switch", { name: /tdd · codex/ }));
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.install");
      expect(body.name).toBe("tdd");
      expect(body.targets).toEqual(["codex"]);
    });
  });

  it("warns on partial uninstall and disables Apply", () => {
    renderPanel({ name: "tdd", installedOn: ["opencode", "codex"] });
    // Toggle one of two installed platforms off
    fireEvent.click(screen.getByRole("switch", { name: /tdd · opencode/ }));
    expect(
      screen.getByText(/skill uninstall removes the skill from ALL platforms/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply changes/i })).toHaveAttribute("disabled");
  });

  it("full uninstall: POSTs skill.uninstall when ALL installed platforms toggled off", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel({ name: "tdd", installedOn: ["opencode"] });
    fireEvent.click(screen.getByRole("switch", { name: /tdd · opencode/ }));
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.uninstall");
      expect(body.name).toBe("tdd");
    });
  });

  it("Update button POSTs skill.update by name", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/jobs": { jobId: "j" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel({ name: "tdd", installedOn: ["opencode"] });
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/jobs") && x.init?.method === "POST");
      expect(c).toBeDefined();
      const body = JSON.parse((c!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.update");
      expect(body.name).toBe("tdd");
    });
  });
});
