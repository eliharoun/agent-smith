import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";

// shared mutable state controllable per test
const streamState: { events: JobEvent[] } = { events: [] };
const respondMock = vi.fn(async (_id: string, _answer: string) => ({ ok: true as const }));

vi.mock("@/hooks/useJobStream", () => ({
  useJobStream: () => streamState.events,
}));

vi.mock("@/hooks/useJob", () => ({
  useJob: () => ({ data: { id: "job-1", preview: "smith agent install x", status: "running" } }),
}));

vi.mock("@/api/jobs", async () => {
  const actual = await vi.importActual<typeof import("@/api/jobs")>("@/api/jobs");
  return {
    ...actual,
    jobsApi: {
      ...actual.jobsApi,
      respond: (id: string, answer: string) => respondMock(id, answer),
    },
  };
});

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

describe("JobStreamModal prompt branch", () => {
  it("renders the prompt question and input when a prompt event arrives without exit", () => {
    streamState.events = [
      { type: "stdout", chunk: "running…\n" },
      { type: "prompt", id: "p1", question: "Continue with these changes?" },
    ];
    useActiveJobsStore.setState({
      active: ["job-1"],
      commands: { "job-1": "agent.install" },
      exits: {},
    });
    renderModal();
    expect(screen.getByText(/Continue with these changes\?/)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt response p1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("hides the prompt input once an exit event follows the prompt", () => {
    streamState.events = [
      { type: "prompt", id: "p1", question: "Continue?" },
      { type: "exit", code: 0, durationMs: 12 },
    ];
    useActiveJobsStore.setState({
      active: ["job-1"],
      commands: { "job-1": "agent.install" },
      exits: {},
    });
    renderModal();
    expect(screen.queryByText(/^Continue\?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });

  it("shows the latest prompt when multiple prompts arrive", () => {
    streamState.events = [
      { type: "prompt", id: "p1", question: "first?" },
      { type: "stdout", chunk: "…\n" },
      { type: "prompt", id: "p2", question: "second?" },
    ];
    useActiveJobsStore.setState({
      active: ["job-1"],
      commands: { "job-1": "agent.install" },
      exits: {},
    });
    renderModal();
    expect(screen.getByText(/second\?/)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt response p2/i)).toBeInTheDocument();
    expect(screen.queryByText(/^first\?$/)).not.toBeInTheDocument();
  });

  it("calls jobsApi.respond with (jobId, answer) when Send is clicked", async () => {
    respondMock.mockClear();
    streamState.events = [{ type: "prompt", id: "p1", question: "Continue?" }];
    useActiveJobsStore.setState({
      active: ["job-1"],
      commands: { "job-1": "agent.install" },
      exits: {},
    });
    renderModal();
    const input = screen.getByLabelText(/prompt response p1/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledWith("job-1", "yes"));
  });
});
