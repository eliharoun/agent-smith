import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenShell } from "./ScreenShell";

describe("ScreenShell", () => {
  it("renders children inside the shell", () => {
    render(<ScreenShell>hello</ScreenShell>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
