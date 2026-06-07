import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QuickActions } from "./QuickActions";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("QuickActions", () => {
  it("'+ Add agent' is a button (not a link) and navigates to /agents?add=true on click", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    const btn = screen.getByRole("button", { name: /\+ add agent/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /new agent/i })).toBeNull();
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith("/agents?add=true");
  });

  it("'+ Add skill' is a button and navigates to /skills?add=true on click", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    const btn = screen.getByRole("button", { name: /\+ add skill/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith("/skills?add=true");
  });

  it("renders the agents group: Browse agents + Manage installs", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /browse agents/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /manage installs/i })).toBeInTheDocument();
  });

  it("renders the skills group: Browse skills", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /browse skills/i })).toBeInTheDocument();
  });

  it("renders the system group: Run doctor", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /run doctor/i })).toBeInTheDocument();
  });

  it("shows use-case group labels (agents / skills / system)", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.getByText("agents")).toBeInTheDocument();
    expect(screen.getByText("skills")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("no longer shows the old 'Install matrix' label", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: /install matrix/i })).toBeNull();
  });
});
