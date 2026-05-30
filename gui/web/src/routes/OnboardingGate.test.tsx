import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "./OnboardingGate";

function makeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  });
}

function renderGate(initialPath = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/"
            element={
              <OnboardingGate>
                <div>HOME_CONTENT</div>
              </OnboardingGate>
            }
          />
          <Route path="/onboarding" element={<div>ONBOARDING_SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OnboardingGate", () => {
  beforeEach(() => {
    sessionStorage.setItem("smith.gui.token", "t");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /onboarding when settings.tourCompleted === false (replay tour)", async () => {
    global.fetch = makeFetch({
      "/api/onboarding": {
        state: "HOME",
        detectedTools: { opencode: true, claudeCode: false, codex: false },
        agentCount: 0,
      },
      "/api/settings": { tourCompleted: false },
    }) as unknown as typeof fetch;

    renderGate("/");

    expect(await screen.findByText("ONBOARDING_SCREEN")).toBeInTheDocument();
  });

  it("does not redirect when settings.tourCompleted === true and state is HOME", async () => {
    global.fetch = makeFetch({
      "/api/onboarding": {
        state: "HOME",
        detectedTools: { opencode: true, claudeCode: false, codex: false },
        agentCount: 0,
      },
      "/api/settings": { tourCompleted: true },
    }) as unknown as typeof fetch;

    renderGate("/");

    expect(await screen.findByText("HOME_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("ONBOARDING_SCREEN")).not.toBeInTheDocument();
  });

  it("does not redirect while settings is still loading (treats undefined as no replay)", async () => {
    let resolveSettings: (v: Response) => void = () => {};
    const settingsPromise = new Promise<Response>((r) => {
      resolveSettings = r;
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/onboarding")) {
        return new Response(
          JSON.stringify({
            state: "HOME",
            detectedTools: { opencode: true, claudeCode: false, codex: false },
            agentCount: 0,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/settings")) return settingsPromise;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    renderGate("/");

    // HOME content shows once onboarding query resolves; settings still pending.
    await waitFor(() => expect(screen.getByText("HOME_CONTENT")).toBeInTheDocument());
    expect(screen.queryByText("ONBOARDING_SCREEN")).not.toBeInTheDocument();

    // Resolve to clean up.
    resolveSettings(new Response(JSON.stringify({ tourCompleted: true }), { status: 200 }));
  });

  it("redirects to /onboarding when state is FIRST_RUN (existing behavior)", async () => {
    global.fetch = makeFetch({
      "/api/onboarding": {
        state: "FIRST_RUN",
        detectedTools: { opencode: false, claudeCode: false, codex: false },
        agentCount: 0,
      },
      "/api/settings": { tourCompleted: true },
    }) as unknown as typeof fetch;

    renderGate("/");

    expect(await screen.findByText("ONBOARDING_SCREEN")).toBeInTheDocument();
  });
});
