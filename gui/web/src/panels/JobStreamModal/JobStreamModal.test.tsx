import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";

// Per-test mutable streams (mocked useJobStream reads from this).
const streamState: { events: Record<string, JobEvent[]> } = { events: {} };

vi.mock("@/hooks/useJobStream", () => ({
  useJobStream: (jobId: string | undefined) => (jobId ? (streamState.events[jobId] ?? []) : []),
}));

vi.mock("@/hooks/useJob", () => ({
  useJob: (jobId: string | undefined) => ({
    data: jobId ? { id: jobId, preview: `preview for ${jobId}`, status: "running" } : undefined,
  }),
}));

import { useActiveJobsStore } from "@/store/active-jobs";
import { JobStreamModal } from "./JobStreamModal";

function renderModal() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <JobStreamModal />
    </QueryClientProvider>,
  );
}

describe("JobStreamModal", () => {
  it("renders nothing when there are no active jobs", () => {
    useActiveJobsStore.setState({ active: [], commands: {}, exits: {} });
    streamState.events = {};
    const { container } = renderModal();
    expect(container.firstChild).toBeNull();
  });

  it("stays mounted after exit and shows Close button with success exit summary", () => {
    streamState.events = {
      "job-1": [{ type: "exit", code: 0, durationMs: 100 }],
    };
    useActiveJobsStore.setState({
      active: ["job-1"],
      commands: { "job-1": "agent.install" },
      exits: { "job-1": { code: 0, durationMs: 100 } },
    });
    renderModal();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    // Green success summary line includes durationMs.
    expect(screen.getByText(/completed \(exit 0 · 100ms\)/i)).toBeInTheDocument();
  });

  it("renders amber failure summary when exit code is non-zero", () => {
    streamState.events = {
      "job-2": [{ type: "exit", code: 1, durationMs: 50 }],
    };
    useActiveJobsStore.setState({
      active: ["job-2"],
      commands: { "job-2": "agent.destroy" },
      exits: { "job-2": { code: 1, durationMs: 50 } },
    });
    renderModal();
    expect(screen.getByText(/failed with exit code 1/i)).toBeInTheDocument();
  });

  it("renders the oldest exited job when multiple are queued", () => {
    streamState.events = {
      "new-running": [],
      "old-exited": [{ type: "exit", code: 1, durationMs: 9 }],
    };
    useActiveJobsStore.setState({
      active: ["new-running", "old-exited"],
      commands: { "new-running": "agent.install", "old-exited": "agent.destroy" },
      exits: { "old-exited": { code: 1 } },
    });
    renderModal();
    // The modal should be showing the OLD-EXITED job (preview from useJob mock).
    expect(screen.getByText(/preview for old-exited/)).toBeInTheDocument();
    expect(screen.queryByText(/preview for new-running/)).not.toBeInTheDocument();
  });

  it("clicking Close drops the current job from the store", () => {
    streamState.events = {
      "job-3": [{ type: "exit", code: 0, durationMs: 1 }],
    };
    useActiveJobsStore.setState({
      active: ["job-3"],
      commands: { "job-3": "agent.install" },
      exits: { "job-3": { code: 0 } },
    });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(useActiveJobsStore.getState().active).not.toContain("job-3");
    expect(useActiveJobsStore.getState().exits["job-3"]).toBeUndefined();
  });

  it("does not show Close button while job is still running", () => {
    streamState.events = {
      "job-running": [{ type: "stdout", chunk: "working...\n" }],
    };
    useActiveJobsStore.setState({
      active: ["job-running"],
      commands: { "job-running": "agent.install" },
      exits: {},
    });
    renderModal();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
  });

  it("re-shows the modal when the selected job switches to a new id after minimize", () => {
    // Start with job A as the active job.
    streamState.events = {
      "job-A": [{ type: "stdout", chunk: "A running\n" }],
      "job-B": [{ type: "stdout", chunk: "B running\n" }],
    };
    useActiveJobsStore.setState({
      active: ["job-A"],
      commands: { "job-A": "agent.install" },
      exits: {},
    });
    renderModal();
    // Modal shows job A.
    expect(screen.getByText(/preview for job-A/)).toBeInTheDocument();
    // User minimizes.
    fireEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(screen.queryByText(/preview for job-A/)).not.toBeInTheDocument();
    // Now the store changes such that the selected job becomes a different id.
    act(() => {
      useActiveJobsStore.setState({
        active: ["job-B"],
        commands: { "job-B": "agent.install" },
        exits: {},
      });
    });
    // The modal should re-appear for the new job (hidden state must reset on id change).
    expect(screen.getByText(/preview for job-B/)).toBeInTheDocument();
  });

  it("shows 0ms duration when exit completes instantly (durationMs === 0)", () => {
    streamState.events = {
      "job-zero": [{ type: "exit", code: 0, durationMs: 0 }],
    };
    useActiveJobsStore.setState({
      active: ["job-zero"],
      commands: { "job-zero": "agent.install" },
      exits: { "job-zero": { code: 0, durationMs: 0 } },
    });
    renderModal();
    expect(screen.getByText(/completed \(exit 0 · 0ms\)/i)).toBeInTheDocument();
  });

  // NOTE: contract test, not a bleed-bug repro — the useJobStream mock already
  // partitions events by jobId. The real bleed fix lives in useJobStream's
  // own state-reset effect; this test guards against re-introducing a bleed
  // at the modal rendering layer (e.g. memoizing `lines` across job changes).
  it("clears prior job's log lines when current job-id changes", () => {
    streamState.events = {
      "job-A": [{ type: "stdout", chunk: "secret-from-A\n" }],
      "job-B": [],
    };
    useActiveJobsStore.setState({
      active: ["job-A"],
      commands: { "job-A": "agent.install" },
      exits: {},
    });
    const { rerender } = renderModal();
    expect(screen.getByText(/secret-from-A/)).toBeInTheDocument();
    // Switch the selected job to B (no events yet, not done).
    act(() => {
      useActiveJobsStore.setState({
        active: ["job-B"],
        commands: { "job-B": "agent.install" },
        exits: {},
      });
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <JobStreamModal />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/secret-from-A/)).not.toBeInTheDocument();
  });

  it("shows 'starting…' placeholder when events empty and not done", () => {
    streamState.events = { "job-pending": [] };
    useActiveJobsStore.setState({
      active: ["job-pending"],
      commands: { "job-pending": "agent.install" },
      exits: {},
    });
    renderModal();
    expect(screen.getByText(/starting/i)).toBeInTheDocument();
  });

  it("redacts URL credentials from streamed stdout and stderr (C4.4.3)", () => {
    streamState.events = {
      "job-redact": [
        { type: "stdout", chunk: "Cloning from https://alice:secret@host.example/o/r.git" },
        { type: "stderr", chunk: "fatal: auth https://tok:abc@host.example/o/r" },
      ],
    };
    useActiveJobsStore.setState({
      active: ["job-redact"],
      commands: { "job-redact": "agent.install" },
      exits: {},
    });
    renderModal();
    // Redacted forms present, raw credentials absent.
    expect(screen.getByText(/https:\/\/\*\*\*@host\.example\/o\/r\.git/)).toBeInTheDocument();
    expect(
      screen.getByText(/fatal: auth https:\/\/\*\*\*@host\.example\/o\/r/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/alice:secret/)).toBeNull();
    expect(screen.queryByText(/tok:abc/)).toBeNull();
  });

  it("omits the duration suffix when durationMs is undefined", () => {
    streamState.events = {
      "job-nodur": [],
    };
    useActiveJobsStore.setState({
      active: ["job-nodur"],
      commands: { "job-nodur": "agent.install" },
      exits: { "job-nodur": { code: 0 } },
    });
    renderModal();
    expect(screen.getByText(/completed \(exit 0\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/ms\)/)).not.toBeInTheDocument();
  });
});
