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

describe("Agents route — + Add agent button (v1.13.0)", () => {
  it("renders a single '+ Add agent' button", () => {
    render(<TestProviders><AgentsList /></TestProviders>);
    expect(screen.getByRole("button", { name: /\+ add agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install from url/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /\+ new agent/i })).toBeNull();
  });

  it("renders 'Install across platforms' secondary link", () => {
    render(<TestProviders><AgentsList /></TestProviders>);
    expect(screen.getByRole("link", { name: /install across platforms/i })).toBeInTheDocument();
  });

  it("opens AddAgentModal when '+ Add agent' is clicked", () => {
    render(<TestProviders><AgentsList /></TestProviders>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+ add agent/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("?add=true opens modal on mount in menu view", () => {
    render(<TestProviders initialEntries={["/agents?add=true"]}><AgentsList /></TestProviders>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("?add=install opens modal in install view directly", () => {
    render(<TestProviders initialEntries={["/agents?add=install"]}><AgentsList /></TestProviders>);
    // install view renders the InstallExistingForm sub-form (also role=dialog)
    // so there are 2 nested dialogs — verify the outer one is present and
    // the "start from template" menu card is NOT shown (we're past the menu)
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });
});
