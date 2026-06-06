import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { Catalogs } from "./Catalogs";

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  global.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
});

describe("Catalogs route (v1.13.0)", () => {
  it("'+ Register' button opens the modal in register view (no card picker)", () => {
    render(<TestProviders><Catalogs /></TestProviders>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+ register/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("?add=register query param opens modal on mount in register view", () => {
    render(<TestProviders initialEntries={["/catalogs?add=register"]}><Catalogs /></TestProviders>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start from template/i })).toBeNull();
  });

  it("?add=register&registry=skill opens with skill registry preselected", () => {
    render(<TestProviders initialEntries={["/catalogs?add=register&registry=skill"]}><Catalogs /></TestProviders>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Skill-only kinds present, agent-only kinds absent => skill registry is active.
    expect(document.querySelector('input[type="radio"][value="user-local"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="team-shared"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="radio"][value="project"]')).toBeNull();
  });

  it("back arrow is hidden (lockedView) — no navigation away from register form", () => {
    render(<TestProviders><Catalogs /></TestProviders>);
    fireEvent.click(screen.getByRole("button", { name: /\+ register/i }));
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
  });
});
