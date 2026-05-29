import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { AgentsList } from "./Agents";

// AgentList inside the route fires network requests; stub fetch so the route
// mounts cleanly. We only care about chrome header behavior in this file.
beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/agents/installed-statuses")) {
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/api/agents")) {
      return new Response("[]", { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Agents route Install-from-URL button (C4.8.2)", () => {
  it("renders the Install-from-URL button in the chrome header", () => {
    render(
      <TestProviders>
        <AgentsList />
      </TestProviders>,
    );
    expect(screen.getByRole("button", { name: /install from url/i })).toBeInTheDocument();
  });

  it("renders the green pulse dot adjacent to the button", () => {
    render(
      <TestProviders>
        <AgentsList />
      </TestProviders>,
    );
    const button = screen.getByRole("button", { name: /install from url/i });
    expect(button.parentElement?.querySelector("[data-pulse-dot]")).toBeInTheDocument();
  });

  it("opens InstallFromUrlModal when the button is clicked", () => {
    render(
      <TestProviders>
        <AgentsList />
      </TestProviders>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /install from url/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent?.toLowerCase()).toContain("install agent from url");
  });
});
