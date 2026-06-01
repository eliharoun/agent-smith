import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

/**
 * Tooltip is a generic ARIA-compliant popover. The trigger element is rendered
 * as `children`; the tooltip body is `content`. Open on hover/focus, close on
 * leave/blur/Esc/click-outside. Rendered into a portal so modal overflow:hidden
 * can't clip it.
 */

describe("Tooltip", () => {
  it("renders the trigger and hides the tooltip by default", () => {
    render(
      <Tooltip content="hello world">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: /trigger/i })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover-in and closes on hover-out", () => {
    render(
      <Tooltip content="hello world">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/hello world/);
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on focus and closes on blur", () => {
    render(
      <Tooltip content="focus body">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/focus body/);
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on Escape while open", () => {
    render(
      <Tooltip content="esc body">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on click outside while open", () => {
    render(
      <div>
        <Tooltip content="outside body">
          <button type="button">trigger</button>
        </Tooltip>
        <div data-testid="outside">elsewhere</div>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("wires aria-describedby on the trigger to the tooltip id", () => {
    render(
      <Tooltip content="aria body">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(tooltip.id).toBe(describedBy);
  });

  it("respects an explicit id prop for aria-describedby", () => {
    render(
      <Tooltip content="explicit id" id="explicit-id-1">
        <button type="button">trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: /trigger/i });
    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-describedby")).toBe("explicit-id-1");
    expect(screen.getByRole("tooltip").id).toBe("explicit-id-1");
  });
});
