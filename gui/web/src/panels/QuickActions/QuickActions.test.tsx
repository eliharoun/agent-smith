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

  it("renders Browse agents, Install matrix, and Run doctor actions", () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /browse agents/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /install matrix/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run doctor/i })).toBeInTheDocument();
  });
});
