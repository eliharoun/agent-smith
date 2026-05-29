import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ModelConfigPage } from "./ModelConfigPage";

type Call = { url: string; init?: RequestInit };

function mockFetch(state: { config: Record<string, unknown>; putStatus?: number }, calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push(init !== undefined ? { url, init } : { url });
    if (url.endsWith("/api/model-config") && method === "GET") {
      return new Response(JSON.stringify(state.config), { status: 200 });
    }
    if (url.endsWith("/api/model-config") && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.preferenceOrder) {
        (state.config as Record<string, unknown>).preferenceOrder = body.preferenceOrder.map(
          (p: string) => ({ provider: p, source: "file" }),
        );
      }
      return new Response(JSON.stringify(state.config), { status: state.putStatus ?? 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ModelConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const defaultConfig = {
  detectedProviders: ["github-copilot", "anthropic"],
  preferenceOrder: [
    { provider: "github-copilot", source: "default" },
    { provider: "anthropic", source: "default" },
  ],
  tierPreview: [
    { tier: "high", resolved: "github-copilot/claude-opus-4.7", source: "live" },
    { tier: "balanced", resolved: "github-copilot/claude-sonnet-4.6", source: "live" },
    { tier: "fast", resolved: "github-copilot/claude-haiku-4.5", source: "live" },
  ],
  tierOverrides: { high: null, balanced: null, fast: null },
  platforms: {
    opencode: { cliInstalled: true, status: "authenticated" },
    "claude-code": { cliInstalled: true, status: "authenticated", availableModels: ["opus", "sonnet"] },
    codex: { cliInstalled: false, status: "cli-not-installed" },
    kiro: { cliInstalled: true, status: "authenticated" },
  },
  tierMatrix: [
    {
      tier: "high",
      perPlatform: {
        opencode: "github-copilot/claude-opus-4.7",
        "claude-code": "opus",
        codex: null,
        kiro: "claude-opus-4.6",
      },
    },
    {
      tier: "balanced",
      perPlatform: {
        opencode: "github-copilot/claude-sonnet-4.6",
        "claude-code": "sonnet",
        codex: null,
        kiro: "claude-sonnet-4.6",
      },
    },
    {
      tier: "fast",
      perPlatform: {
        opencode: "github-copilot/claude-haiku-4.5",
        "claude-code": null,
        codex: null,
        kiro: "claude-haiku-4.5",
      },
    },
  ],
  perPlatformTierOverrides: {
    opencode: { high: null, balanced: null, fast: null },
    "claude-code": { high: null, balanced: null, fast: null },
    codex: { high: null, balanced: null, fast: null },
    kiro: { high: null, balanced: null, fast: null },
  },
};

describe("ModelConfigPage", () => {
  it("renders four cards: readiness, opencode preference, tier preview, overrides", async () => {
    const calls: Call[] = [];
    globalThis.fetch = mockFetch({ config: defaultConfig }, calls) as typeof fetch;
    renderPage();
    // Headers were rephrased for plain-language clarity (the original
    // "// opencode provider preference" left users asking "what does
    // even mean?"). Match on stable substrings of each card.
    await waitFor(() =>
      expect(screen.getByText(/platforms.*installed and authenticated/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/which provider is tried first/i)).toBeInTheDocument();
    expect(screen.getByText(/tier resolution preview/i)).toBeInTheDocument();
    expect(screen.getByText(/pin a specific model/i)).toBeInTheDocument();
  });

  it("displays platform readiness for all four platforms", async () => {
    const calls: Call[] = [];
    globalThis.fetch = mockFetch({ config: defaultConfig }, calls) as typeof fetch;
    renderPage();
    // "OpenCode", "Claude Code", "Codex", "Kiro" each appear in TWO
    // places (the readiness card AND the tier matrix table header).
    // getAllByText asserts presence without overspecifying.
    await waitFor(() => expect(screen.getAllByText("OpenCode").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kiro").length).toBeGreaterThan(0);
  });

  it("displays detected providers in the OpenCode preference list", async () => {
    const calls: Call[] = [];
    globalThis.fetch = mockFetch({ config: defaultConfig }, calls) as typeof fetch;
    renderPage();
    await waitFor(() => expect(screen.getAllByText("github-copilot").length).toBeGreaterThan(0));
    expect(screen.getAllByText("anthropic").length).toBeGreaterThan(0);
  });

  it("save button invokes PUT with reordered preferences", async () => {
    const calls: Call[] = [];
    globalThis.fetch = mockFetch({ config: defaultConfig }, calls) as typeof fetch;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/which provider is tried first/i)).toBeInTheDocument(),
    );
    // Click down on first provider to move it down
    const downButtons = screen.getAllByRole("button", { name: /↓/i });
    fireEvent.click(downButtons[0]!);
    // Click save
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT");
      expect(put).toBeDefined();
      const body = JSON.parse(String(put?.init?.body ?? "{}"));
      expect(body.preferenceOrder[0]).toBe("anthropic");
      expect(body.preferenceOrder[1]).toBe("github-copilot");
    });
  });
});
