import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldHelp } from "./FieldHelp";

describe("FieldHelp", () => {
  it("renders the label text", () => {
    render(<FieldHelp fieldId="knowledge.delivery">delivery</FieldHelp>);
    expect(screen.getByText(/delivery/i)).toBeInTheDocument();
  });

  it("renders an info-icon trigger when the registry has a matching entry", () => {
    render(<FieldHelp fieldId="knowledge.delivery">delivery</FieldHelp>);
    // The icon trigger is a button so it's keyboard-focusable.
    const trigger = screen.getByRole("button", { name: /help.*delivery/i });
    expect(trigger).toBeInTheDocument();
  });

  it("renders only the label when the fieldId is unknown (no icon, no crash)", () => {
    render(<FieldHelp fieldId="not.in.registry">label-only</FieldHelp>);
    expect(screen.getByText(/label-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /help/i })).not.toBeInTheDocument();
  });

  it("opens the tooltip on focus and shows help text", () => {
    render(<FieldHelp fieldId="knowledge.delivery">delivery</FieldHelp>);
    const trigger = screen.getByRole("button", { name: /help.*delivery/i });
    fireEvent.focus(trigger);
    const tt = screen.getByRole("tooltip");
    expect(tt.textContent).toMatch(/inline|file|auto/i);
  });

  it("the icon trigger is type=button (does not submit a parent form)", () => {
    let submitted = 0;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted++;
        }}
      >
        <FieldHelp fieldId="knowledge.delivery">delivery</FieldHelp>
      </form>,
    );
    const trigger = screen.getByRole("button", { name: /help.*delivery/i });
    fireEvent.click(trigger);
    expect(submitted).toBe(0);
  });

  it("threads htmlFor onto the underlying <label>", () => {
    render(
      <FieldHelp fieldId="knowledge.delivery" htmlFor="my-input">
        delivery
      </FieldHelp>,
    );
    const labels = document.querySelectorAll("label");
    const target = Array.from(labels).find((l) => l.getAttribute("for") === "my-input");
    expect(target).toBeDefined();
    expect(target?.textContent).toMatch(/delivery/i);
  });
});
