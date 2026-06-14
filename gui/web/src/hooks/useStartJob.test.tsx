import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveJobsStore } from "@/store/active-jobs";
import { useStartJob } from "./useStartJob";

const server = setupServer(
  http.post("/api/jobs", () =>
    HttpResponse.json({ jobId: "j1", argv: [], preview: "smith doctor" }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  useActiveJobsStore.setState({ active: [], commands: {} });
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useStartJob", () => {
  it("records the started job with its originating command in the active-jobs store", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useStartJob(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        command: "agent.install",
        name: "ada",
        platforms: ["opencode"],
        withSkills: false,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const state = useActiveJobsStore.getState();
    expect(state.active).toContain("j1");
    expect(state.commands.j1).toBe("agent.install");
  });

  it("does NOT invalidate ['agents'] at job-start time (handled by JobCompletionListener on exit)", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useStartJob(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        command: "agent.install",
        name: "ada",
        platforms: ["opencode"],
        withSkills: false,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const agentsCalls = spy.mock.calls.filter(
      (call) => Array.isArray(call[0]?.queryKey) && call[0].queryKey[0] === "agents",
    );
    expect(agentsCalls.length).toBe(0);
  });

  it("does NOT invalidate ['agents'] for non-agent commands like 'doctor'", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useStartJob(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        command: "doctor",
        fixKnowledgeRefresh: false,
        fixKnowledgeCompile: false,
        fixKnowledgeIndex: false,
        fixMcpCommands: false,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const agentsCalls = spy.mock.calls.filter(
      (call) => Array.isArray(call[0]?.queryKey) && call[0].queryKey[0] === "agents",
    );
    expect(agentsCalls.length).toBe(0);
  });
});
