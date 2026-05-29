import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>go</Button>);
    fireEvent.click(screen.getByRole("button", { name: /go/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it("applies danger variant classes", () => {
    render(<Button variant="danger">x</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-matrix-red");
  });
});
