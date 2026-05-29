import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { Skills } from "./Skills";

// Skills route mounts SkillList + SkillBootstrap + SkillCatalogList, all of
// which fire network requests. Stub fetch so the chrome header is the only
// observable surface in this file.
beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/skills/installed-statuses")) {
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/api/skills/catalog")) {
      return new Response("[]", { status: 200 });
    }
    if (url.includes("/api/skills")) {
      return new Response("[]", { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Skills route Install-from-URL button (C4.8.3)", () => {
  it("renders the Install-from-URL button in the chrome header", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    expect(screen.getByRole("button", { name: /install from url/i })).toBeInTheDocument();
  });

  it("renders the green pulse dot adjacent to the button", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    const button = screen.getByRole("button", { name: /install from url/i });
    expect(button.parentElement?.querySelector("[data-pulse-dot]")).toBeInTheDocument();
  });

  it("opens InstallFromUrlModal in skill mode when the button is clicked", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /install from url/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent?.toLowerCase()).toContain("install skill from url");
  });
});
