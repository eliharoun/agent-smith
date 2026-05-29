import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefreshConsent } from "./RefreshConsent";

describe("RefreshConsent", () => {
  it("emits the per-platform consent on Install", () => {
    const onConfirm = vi.fn();
    render(
      <RefreshConsent
        agent="foo"
        platforms={["opencode"]}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onConfirm).toHaveBeenCalledWith({ opencode: "yes" });
  });
});
