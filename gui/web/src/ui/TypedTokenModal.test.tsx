import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TypedTokenModal } from "./TypedTokenModal";

describe("TypedTokenModal", () => {
  it("enables Destroy only when token matches", () => {
    const onConfirm = vi.fn();
    render(
      <TypedTokenModal
        title="Destroy foo"
        body="permanent"
        expectedToken="foo"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /destroy/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "foo" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });
});
