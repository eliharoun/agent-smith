import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CloneModeBanner } from "./CloneModeBanner";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("CloneModeBanner", () => {
  test("renders nothing when inactive", () => {
    const { container } = render(<CloneModeBanner active={false} />);
    expect(container.firstChild).toBeNull();
  });
  test("renders the banner when active", () => {
    render(<CloneModeBanner active />);
    expect(screen.getByText(/clone mode/i)).toBeInTheDocument();
  });
  test("dismissal hides the banner and persists to sessionStorage", () => {
    render(<CloneModeBanner active />);
    fireEvent.click(screen.getByText(/don't show again/i));
    expect(screen.queryByText(/clone mode/i)).toBeNull();
    expect(sessionStorage.getItem("smith.cloneBanner.dismissed")).toBe("1");
  });
  test("stays hidden when already dismissed this session", () => {
    sessionStorage.setItem("smith.cloneBanner.dismissed", "1");
    const { container } = render(<CloneModeBanner active />);
    expect(container.firstChild).toBeNull();
  });
});
