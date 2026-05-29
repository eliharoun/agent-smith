import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalStrip } from "./TerminalStrip";

describe("TerminalStrip", () => {
  it("renders nothing when no active job", () => {
    const { container } = render(<TerminalStrip />);
    expect(container.firstChild).toBeNull();
  });
});
