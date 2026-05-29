import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { QuickActions } from "./QuickActions";

describe("QuickActions", () => {
  it("renders all four primary actions", () => {
    render(
      <MemoryRouter>
        <QuickActions />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /new agent/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse agents/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /install matrix/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run doctor/i })).toBeInTheDocument();
  });
});
