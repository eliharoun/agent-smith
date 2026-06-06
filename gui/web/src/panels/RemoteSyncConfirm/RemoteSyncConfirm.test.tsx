import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "@/test/TestProviders";
import { RemoteSyncConfirm } from "./RemoteSyncConfirm";

const baseProps = {
  kind: "agent" as const,
  name: "alpha",
  url: "https://github.com/o/r.git",
  gitRef: "main",
  cloneDir: "~/.local/state/agent-smith/remote/github.com/o/r",
  open: true,
  onClose: () => {},
  onDispatch: () => {},
};

describe("RemoteSyncConfirm (C4.6.1)", () => {
  it("renders title with name and remote source", () => {
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} />
      </TestProviders>,
    );
    expect(screen.getByText(/sync alpha from/i)).toBeInTheDocument();
    // URL appears in both header and the "Pull updates from" line.
    expect(screen.getAllByText(/github\.com\/o\/r\.git/).length).toBeGreaterThanOrEqual(1);
  });

  it("warns about destructive-of-local-edits", () => {
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} />
      </TestProviders>,
    );
    expect(screen.getByText(/destructive of any local edits/i)).toBeInTheDocument();
  });

  it("renders cloneDir in the warning", () => {
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} />
      </TestProviders>,
    );
    expect(screen.getByText(/github\.com\/o\/r$/)).toBeInTheDocument();
  });

  it("renders 'HEAD' when gitRef is null", () => {
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} gitRef={null} />
      </TestProviders>,
    );
    expect(screen.getByText(/HEAD/)).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    const { container } = render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} open={false} />
      </TestProviders>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Cancel closes without dispatch", () => {
    const onClose = vi.fn();
    const onDispatch = vi.fn();
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} onClose={onClose} onDispatch={onDispatch} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("Sync dispatches agent.sync for kind=agent and closes", () => {
    const onDispatch = vi.fn();
    const onClose = vi.fn();
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} onDispatch={onDispatch} onClose={onClose} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    expect(onDispatch).toHaveBeenCalledWith({ command: "agent.sync", name: "alpha" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Sync dispatches skill.sync for kind=skill", () => {
    const onDispatch = vi.fn();
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} kind="skill" name="arch" onDispatch={onDispatch} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    expect(onDispatch).toHaveBeenCalledWith({ command: "skill.sync", name: "arch" });
  });
});
