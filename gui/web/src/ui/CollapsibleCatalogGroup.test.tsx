import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollapsibleCatalogGroup } from "./CollapsibleCatalogGroup";

describe("CollapsibleCatalogGroup", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("renders header with label + count chip", () => {
    render(
      <CollapsibleCatalogGroup label="platform-ai" count={5} defaultOpen>
        <div>body-content</div>
      </CollapsibleCatalogGroup>,
    );
    expect(screen.getByText(/platform-ai/i)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("body-content")).toBeTruthy();
  });

  it("toggles body visibility on header click", () => {
    render(
      <CollapsibleCatalogGroup label="x" count={1} defaultOpen>
        <div>hidden-when-closed</div>
      </CollapsibleCatalogGroup>,
    );
    const header = screen.getByRole("button");
    fireEvent.click(header);
    expect(screen.queryByText("hidden-when-closed")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("hidden-when-closed")).toBeTruthy();
  });

  it("persists open state under storageKey", () => {
    const { unmount } = render(
      <CollapsibleCatalogGroup label="x" count={1} defaultOpen storageKey="test:x">
        <div>body</div>
      </CollapsibleCatalogGroup>,
    );
    fireEvent.click(screen.getByRole("button")); // close
    unmount();
    render(
      <CollapsibleCatalogGroup label="x" count={1} defaultOpen storageKey="test:x">
        <div>body</div>
      </CollapsibleCatalogGroup>,
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("defaultOpen wins when no persisted state exists", () => {
    render(
      <CollapsibleCatalogGroup label="x" count={1} defaultOpen={false} storageKey="test:fresh">
        <div>body</div>
      </CollapsibleCatalogGroup>,
    );
    expect(screen.queryByText("body")).toBeNull();
  });
});
