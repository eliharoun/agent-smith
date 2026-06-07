import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProtectedBadge } from "./ProtectedBadge";

describe("ProtectedBadge", () => {
  test("renders the default label", () => {
    render(<ProtectedBadge />);
    expect(screen.getByText("Bundled")).toBeInTheDocument();
  });
  test("respects an override label", () => {
    render(<ProtectedBadge label="System" />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });
  test("exposes an accessible label", () => {
    render(<ProtectedBadge />);
    expect(screen.getByLabelText(/bundled/i)).toBeInTheDocument();
  });
});
