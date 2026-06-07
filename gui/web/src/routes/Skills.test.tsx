import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { Skills } from "./Skills";

// Stub fetch for SkillList + SkillBootstrap + SkillCatalogList network calls.
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

describe("Skills route — unified + Add skill button", () => {
  it("renders a single '+ Add skill' button in the chrome header", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    expect(screen.getByRole("button", { name: /\+ add skill/i })).toBeInTheDocument();
    // Old two-button surface is gone
    expect(screen.queryByRole("button", { name: /install from url/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /\+ register/i })).toBeNull();
  });

  it("no pulse dot (the two-button design's pulse dot is removed)", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    expect(document.querySelector("[data-pulse-dot]")).toBeNull();
  });

  it("clicking '+ Add skill' opens AddSkillModal", () => {
    render(
      <TestProviders>
        <Skills />
      </TestProviders>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+ add skill/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Skills route — ?add= query-param deep-links", () => {
  it("?add=true opens AddSkillModal on menu view", () => {
    render(
      <TestProviders initialEntries={["/skills?add=true"]}>
        <Skills />
      </TestProviders>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // menu view: both cards visible
    expect(screen.getByRole("button", { name: /install existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register catalog/i })).toBeInTheDocument();
  });

  it("?add=install opens AddSkillModal on install sub-form", () => {
    render(
      <TestProviders initialEntries={["/skills?add=install"]}>
        <Skills />
      </TestProviders>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // install sub-form: back button visible, menu cards not
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install existing/i })).toBeNull();
  });

  it("?add=register opens AddSkillModal on register sub-form", () => {
    render(
      <TestProviders initialEntries={["/skills?add=register"]}>
        <Skills />
      </TestProviders>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /register catalog/i })).toBeNull();
  });
});
