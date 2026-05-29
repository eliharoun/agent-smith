import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructWizard } from "./ConstructWizard";

type Opts = {
  state: "FIRST_RUN" | "NEEDS_USER_MD" | "ZERO_AGENTS" | "HOME";
  detectedTools?: { opencode: boolean; claudeCode: boolean; codex: boolean };
  installedStatuses?: Record<string, { installed: Record<string, boolean> }>;
};

function setup(initial: Opts) {
  const ref: { current: Opts } = { current: initial };
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const o = ref.current;
    if (url.includes("/api/onboarding-status")) {
      return new Response(
        JSON.stringify({
          state: o.state,
          detectedTools: o.detectedTools ?? { opencode: false, claudeCode: false, codex: false },
          agentCount: 0,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/installed-statuses")) {
      return new Response(JSON.stringify(o.installedStatuses ?? {}), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const qc = new QueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConstructWizard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc, ref };
}

describe("ConstructWizard", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("FIRST_RUN renders the Wake step first", async () => {
    setup({ state: "FIRST_RUN" });
    expect(await screen.findByText(/wake up/i)).toBeInTheDocument();
  });

  it("NEEDS_USER_MD with tools+agent installed jumps to WhoAreYou", async () => {
    setup({
      state: "NEEDS_USER_MD",
      detectedTools: { opencode: true, claudeCode: false, codex: false },
      installedStatuses: { "agent-smith": { installed: { opencode: true } } },
    });
    expect(await screen.findByText(/who are you/i)).toBeInTheDocument();
    expect(screen.queryByText(/wake up/i)).toBeNull();
  });

  it("HOME with tools+agent installed renders YouAreIn (success-only replay tour)", async () => {
    setup({
      state: "HOME",
      detectedTools: { opencode: true, claudeCode: false, codex: false },
      installedStatuses: { "agent-smith": { installed: { opencode: true } } },
    });
    expect(await screen.findByText(/you're in/i)).toBeInTheDocument();
  });

  it("renders an Initializing placeholder while queries are loading", () => {
    sessionStorage.setItem("smith.gui.token", "t");
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConstructWizard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/initializing/i)).toBeInTheDocument();
  });

  it("clamps step state when required shrinks mid-wizard (regression)", async () => {
    // FIRST_RUN with no tools and no agents → required spans all 5 steps.
    const { qc, ref } = setup({ state: "FIRST_RUN" });
    // Wait for Wake to appear (step=0).
    expect(await screen.findByText(/wake up/i)).toBeInTheDocument();
    // Advance past Wake → step=1 (WhoAreYou).
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    expect(await screen.findByText(/who are you/i)).toBeInTheDocument();

    // Mid-wizard, the user's environment changes: HOME state, all tools
    // detected, agent installed → required shrinks to just ["youarein"].
    ref.current = {
      state: "HOME",
      detectedTools: { opencode: true, claudeCode: true, codex: true },
      installedStatuses: { "agent-smith": { installed: { opencode: true } } },
    };
    await qc.invalidateQueries();

    // The render-time clamp picks "youarein" even though step=1 is out of
    // range, and the new useEffect clamps the persistent step state to 0 so
    // subsequent advances start from a valid index. We assert no crash and
    // the terminal step renders.
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument());
    expect(screen.queryByText(/who are you/i)).toBeNull();
  });
});
