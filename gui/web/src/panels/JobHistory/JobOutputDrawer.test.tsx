import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobOutputDrawer } from "./JobOutputDrawer";

// Drawer reads job output via this hook; stub it to a loaded state.
vi.mock("@/hooks/useJobHistory", () => ({
  useJobOutput: () => ({ data: "some output", isLoading: false, error: null }),
}));

describe("JobOutputDrawer", () => {
  it("closes on [close] click, Escape key, and backdrop click", () => {
    const onClose = vi.fn();
    const { rerender } = render(<JobOutputDrawer jobId="j1" onClose={onClose} />);

    fireEvent.click(screen.getByText("[close]"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Backdrop is the dialog container; clicking it (not the panel) closes.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(<JobOutputDrawer jobId="j1" onClose={onClose} />);
  });
});
