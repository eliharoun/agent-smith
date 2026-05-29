import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jobsApi } from "@/api/jobs";
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
    const spy = vi.spyOn(jobsApi, "start").mockResolvedValue({ jobId: "x", preview: "" });
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} onClose={onClose} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Sync dispatches agent.sync for kind=agent and closes", async () => {
    const calls: unknown[] = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req);
      return Promise.resolve({ jobId: "j-sync-a", preview: "" });
    });
    const onClose = vi.fn();
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} onClose={onClose} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ command: "agent.sync", name: "alpha" });
    expect(onClose).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Sync dispatches skill.sync for kind=skill", async () => {
    const calls: unknown[] = [];
    const spy = vi.spyOn(jobsApi, "start").mockImplementation((req) => {
      calls.push(req);
      return Promise.resolve({ jobId: "j-sync-s", preview: "" });
    });
    render(
      <TestProviders>
        <RemoteSyncConfirm {...baseProps} kind="skill" name="arch" />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ command: "skill.sync", name: "arch" });
    spy.mockRestore();
  });
});
