import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaleArtifactsConfirmModal } from "./StaleArtifactsConfirmModal";

describe("StaleArtifactsConfirmModal", () => {
  it("renders the title, body, and three buttons", () => {
    render(
      <StaleArtifactsConfirmModal
        onCancel={() => {}}
        onSaveKeep={() => {}}
        onSaveDelete={() => {}}
      />,
    );
    expect(screen.getByText(/switch to lazy fetch/i)).toBeInTheDocument();
    expect(screen.getByText(/cached content from a previous install/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save and keep cached files/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save and delete cached files/i }),
    ).toBeInTheDocument();
  });

  it("uses dialog role with aria-labelledby pointing at the title", () => {
    render(
      <StaleArtifactsConfirmModal
        onCancel={() => {}}
        onSaveKeep={() => {}}
        onSaveDelete={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy ?? "");
    expect(heading?.textContent).toMatch(/switch to lazy fetch/i);
  });

  it("fires onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <StaleArtifactsConfirmModal
        onCancel={onCancel}
        onSaveKeep={() => {}}
        onSaveDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("fires onSaveKeep when 'Save and keep cached files' is clicked", () => {
    const onSaveKeep = vi.fn();
    render(
      <StaleArtifactsConfirmModal
        onCancel={() => {}}
        onSaveKeep={onSaveKeep}
        onSaveDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save and keep cached files/i }));
    expect(onSaveKeep).toHaveBeenCalledTimes(1);
  });

  it("fires onSaveDelete when 'Save and delete cached files' is clicked", () => {
    const onSaveDelete = vi.fn();
    render(
      <StaleArtifactsConfirmModal
        onCancel={() => {}}
        onSaveKeep={() => {}}
        onSaveDelete={onSaveDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save and delete cached files/i }));
    expect(onSaveDelete).toHaveBeenCalledTimes(1);
  });

  it("dismisses via Escape key (calls onCancel)", () => {
    const onCancel = vi.fn();
    render(
      <StaleArtifactsConfirmModal
        onCancel={onCancel}
        onSaveKeep={() => {}}
        onSaveDelete={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
