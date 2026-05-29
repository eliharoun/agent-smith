import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillBootstrap } from "./SkillBootstrap";

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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SkillBootstrap />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
});

describe("SkillBootstrap", () => {
  it("renders default preview without --dry-run or --targets", () => {
    renderPanel();
    expect(screen.getByText(/^smith skill bootstrap$/)).toBeInTheDocument();
  });

  it("adds --dry-run to preview when dry-run is toggled", () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: /dry-run/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/smith skill bootstrap --dry-run/)).toBeInTheDocument();
  });

  it("adds --targets to preview when platform toggles are enabled", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("switch", { name: /opencode/i }));
    fireEvent.click(screen.getByRole("switch", { name: /codex/i }));
    expect(screen.getByText(/smith skill bootstrap --targets opencode,codex/)).toBeInTheDocument();
  });

  it("POSTs skill.bootstrap to /api/jobs with selected targets + dry-run flag", async () => {
    const calls: Call[] = [];
    global.fetch = vi.fn(
      mockFetch({ "/api/jobs": { jobId: "job-1" } }, calls),
    ) as unknown as typeof fetch;
    renderPanel();
    fireEvent.click(screen.getByRole("switch", { name: /opencode/i }));
    fireEvent.click(screen.getByRole("switch", { name: /dry-run/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Bootstrap$/i }));
    await waitFor(() => {
      const jobCall = calls.find((c) => c.url.includes("/api/jobs") && c.init?.method === "POST");
      expect(jobCall).toBeDefined();
      const body = JSON.parse((jobCall!.init!.body as string) ?? "{}");
      expect(body.command).toBe("skill.bootstrap");
      expect(body.dryRun).toBe(true);
      expect(body.targets).toEqual(["opencode"]);
    });
  });
});
