import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalLog } from "./TerminalLog";

describe("TerminalLog", () => {
  it("renders all lines with the correct kind class", () => {
    render(
      <TerminalLog
        lines={[
          { kind: "stdout", text: "hello" },
          { kind: "stderr", text: "bad" },
        ]}
      />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("bad")).toHaveClass("text-matrix-red");
  });
});

describe("TerminalLog cursor", () => {
  it("does not render a fake blinking cursor (would mislead users into thinking the log is editable)", () => {
    const { container } = render(<TerminalLog lines={[{ kind: "stdout", text: "hello" }]} />);
    expect(container.textContent ?? "").not.toContain("▌");
    expect(container.querySelector(".animate-cursor-blink")).toBeNull();
  });
});
