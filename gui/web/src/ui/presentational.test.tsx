import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./Chip";
import { Lamp } from "./Lamp";
import { ScanlineBackground } from "./ScanlineBackground";

describe("presentational primitives", () => {
  it("Lamp renders with status class", () => {
    const { container } = render(<Lamp status="on" label="DAEMON" />);
    expect(container.querySelector(".bg-matrix-green")).toBeTruthy();
  });
  it("Chip renders tone", () => {
    const { container } = render(<Chip tone="green">ok</Chip>);
    expect(container.firstChild).toHaveClass("text-matrix-green");
  });
  it("ScanlineBackground returns null on low", () => {
    const { container } = render(<ScanlineBackground intensity="low" />);
    expect(container.firstChild).toBeNull();
  });
});
