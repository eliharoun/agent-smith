import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstAgent } from "./FirstAgent";

function setup(installedStatuses: Record<string, { installed: Record<string, boolean> }>) {
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/installed-statuses")) {
      return new Response(JSON.stringify(installedStatuses), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <FirstAgent onNext={() => {}} />
    </QueryClientProvider>,
  );
}

describe("FirstAgent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows an Installed pill for already-installed recommendations", async () => {
    setup({ "agent-smith": { installed: { opencode: true } } });
    expect(await screen.findByText(/installed/i)).toBeInTheDocument();
  });

  it("does not show Installed pill when none are installed", async () => {
    setup({});
    await screen.findByText(/agent-smith/i);
    expect(screen.queryByText(/^installed$/i)).toBeNull();
  });

  it("disabled card has aria-label naming the agent and the reason", async () => {
    setup({ "agent-smith": { installed: { opencode: true } } });
    const btn = await screen.findByRole("button", {
      name: "agent-smith (already installed)",
    });
    expect(btn).toBeDisabled();
  });

  it("enabled card has no aria-label override", async () => {
    setup({});
    await screen.findByText(/agent-smith/i);
    // The button's accessible name comes from its visible content, not aria-label.
    const buttons = screen.getAllByRole("button");
    const agentBtn = buttons.find((b) => b.textContent?.includes("agent-smith"));
    expect(agentBtn).toBeDefined();
    expect(agentBtn).not.toHaveAttribute("aria-label");
    expect(agentBtn).not.toBeDisabled();
  });
});
