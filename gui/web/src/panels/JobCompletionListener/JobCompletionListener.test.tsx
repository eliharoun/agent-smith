import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";

// Per-test mutable map of jobId -> events. The mocked useJobStream reads from this.
const streamState: { events: Record<string, JobEvent[]> } = { events: {} };

vi.mock("@/hooks/useJobStream", () => ({
  useJobStream: (jobId: string | undefined) => (jobId ? (streamState.events[jobId] ?? []) : []),
}));

import { useActiveJobsStore } from "@/store/active-jobs";
import { JobCompletionListener } from "./JobCompletionListener";

function renderWith(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <JobCompletionListener />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  streamState.events = {};
  useActiveJobsStore.setState({ active: [], commands: {}, exits: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobCompletionListener", () => {
  it("invalidates ['agents'] and ['onboarding'], records exit (does NOT drop) on agent.* exit", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let agentsFetches = 0;
    let onboardingFetches = 0;
    function Probe() {
      const a = useQuery({
        queryKey: ["agents"],
        queryFn: () => {
          agentsFetches++;
          return { fetched: agentsFetches };
        },
      });
      const o = useQuery({
        queryKey: ["onboarding"],
        queryFn: () => {
          onboardingFetches++;
          return { fetched: onboardingFetches };
        },
      });
      return <span>{a.data && o.data ? "ok" : "loading"}</span>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(agentsFetches).toBe(1));
    await waitFor(() => expect(onboardingFetches).toBe(1));
    // Job is in flight, no exit yet.
    streamState.events["job-1"] = [];
    act(() => {
      useActiveJobsStore.getState().push("job-1", "agent.install");
    });
    expect(agentsFetches).toBe(1);
    expect(onboardingFetches).toBe(1);
    // Now exit fires and the listener observes it via re-render.
    streamState.events["job-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => {
      useActiveJobsStore.getState().push("job-1", "agent.install");
    });
    await waitFor(() => {
      expect(useActiveJobsStore.getState().exits["job-1"]).toEqual({ code: 0, durationMs: 5 });
    });
    // Job stays in active until user dismisses.
    expect(useActiveJobsStore.getState().active).toContain("job-1");
    await waitFor(() => expect(agentsFetches).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(onboardingFetches).toBeGreaterThanOrEqual(2));
  });

  it("does not invalidate ['agents'] or ['onboarding'] when a non-agent.* command exits", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let agentsFetches = 0;
    let onboardingFetches = 0;
    function Probe() {
      const a = useQuery({
        queryKey: ["agents"],
        queryFn: () => {
          agentsFetches++;
          return { fetched: agentsFetches };
        },
      });
      const o = useQuery({
        queryKey: ["onboarding"],
        queryFn: () => {
          onboardingFetches++;
          return { fetched: onboardingFetches };
        },
      });
      return <span>{a.data && o.data ? "ok" : "loading"}</span>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(agentsFetches).toBe(1));
    await waitFor(() => expect(onboardingFetches).toBe(1));
    streamState.events["job-2"] = [{ type: "exit", code: 0, durationMs: 1 }];
    act(() => {
      useActiveJobsStore.getState().push("job-2", "doctor.run");
    });
    await waitFor(() => {
      expect(useActiveJobsStore.getState().exits["job-2"]).toEqual({ code: 0, durationMs: 1 });
    });
    // Still 1 — no second refetch triggered by invalidation.
    expect(agentsFetches).toBe(1);
    expect(onboardingFetches).toBe(1);
  });

  it("invalidates ['agents'] and ['onboarding'] even when the job exits non-zero (failed destroy/install)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let agentsFetches = 0;
    let onboardingFetches = 0;
    function Probe() {
      const a = useQuery({
        queryKey: ["agents"],
        queryFn: () => {
          agentsFetches++;
          return { fetched: agentsFetches };
        },
      });
      const o = useQuery({
        queryKey: ["onboarding"],
        queryFn: () => {
          onboardingFetches++;
          return { fetched: onboardingFetches };
        },
      });
      return <span>{a.data && o.data ? "ok" : "loading"}</span>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(agentsFetches).toBe(1));
    await waitFor(() => expect(onboardingFetches).toBe(1));
    streamState.events["job-3"] = [{ type: "exit", code: 1, durationMs: 7 }];
    act(() => {
      useActiveJobsStore.getState().push("job-3", "agent.destroy");
    });
    await waitFor(() => expect(agentsFetches).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(onboardingFetches).toBeGreaterThanOrEqual(2));
    // markExit called, drop not called: job still active, exit recorded.
    expect(useActiveJobsStore.getState().exits["job-3"]).toEqual({ code: 1, durationMs: 7 });
    expect(useActiveJobsStore.getState().active).toContain("job-3");
  });

  it("renders nothing visible (no DOM output)", () => {
    const qc = new QueryClient();
    const { container } = renderWith(qc);
    expect(container.firstChild).toBeNull();
  });
});

describe("JobCompletionListener — destroy flow timing", () => {
  it("does NOT invalidate ['agents'] before exit fires (destroy regression)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let agentsFetches = 0;
    function Probe() {
      const q = useQuery({
        queryKey: ["agents"],
        queryFn: () => {
          agentsFetches++;
          return { fetched: agentsFetches };
        },
      });
      return <span>{q.data ? "ok" : "loading"}</span>;
    }
    useActiveJobsStore.getState().push("job-x", "agent.destroy");
    streamState.events["job-x"] = [
      { type: "stdout", chunk: "destroying...\n" },
      // No exit yet.
    ];
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(agentsFetches).toBe(1));
    // Still in flight, no invalidation should have fired.
    expect(agentsFetches).toBe(1);
    expect(useActiveJobsStore.getState().active).toContain("job-x");
    expect(useActiveJobsStore.getState().exits["job-x"]).toBeUndefined();
  });
});

describe("JobCompletionListener — Phase 2 cache invalidations", () => {
  function probeFor(qc: QueryClient, key: string[]) {
    let fetches = 0;
    function Probe() {
      const q = useQuery({
        queryKey: key,
        queryFn: () => {
          fetches++;
          return { fetched: fetches };
        },
      });
      return <span>{q.data ? "ok" : "loading"}</span>;
    }
    return { Probe, fetches: () => fetches };
  }

  it("invalidates skills, installed-skills, skill-catalogs, catalogs on skill.* exit", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const skills = probeFor(qc, ["skills"]);
    const installed = probeFor(qc, ["installed-skills"]);
    const skillCatalogs = probeFor(qc, ["skill-catalogs"]);
    const catalogs = probeFor(qc, ["catalogs"]);
    render(
      <QueryClientProvider client={qc}>
        <skills.Probe />
        <installed.Probe />
        <skillCatalogs.Probe />
        <catalogs.Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(skills.fetches()).toBe(1));
    await waitFor(() => expect(installed.fetches()).toBe(1));
    await waitFor(() => expect(skillCatalogs.fetches()).toBe(1));
    await waitFor(() => expect(catalogs.fetches()).toBe(1));
    streamState.events["job-skill"] = [{ type: "exit", code: 0, durationMs: 2 }];
    act(() => {
      useActiveJobsStore.getState().push("job-skill", "skill.install");
    });
    await waitFor(() => expect(skills.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(installed.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(skillCatalogs.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(catalogs.fetches()).toBeGreaterThanOrEqual(2));
  });

  it("invalidates catalogs + agents on agent.register exit", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const catalogs = probeFor(qc, ["catalogs"]);
    const agents = probeFor(qc, ["agents"]);
    render(
      <QueryClientProvider client={qc}>
        <catalogs.Probe />
        <agents.Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(catalogs.fetches()).toBe(1));
    await waitFor(() => expect(agents.fetches()).toBe(1));
    streamState.events["job-reg"] = [{ type: "exit", code: 0, durationMs: 3 }];
    act(() => {
      useActiveJobsStore.getState().push("job-reg", "agent.register");
    });
    await waitFor(() => expect(catalogs.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(agents.fetches()).toBeGreaterThanOrEqual(2));
  });

  it("invalidates catalogs + agents on agent.catalog-rename exit", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const catalogs = probeFor(qc, ["catalogs"]);
    const agents = probeFor(qc, ["agents"]);
    render(
      <QueryClientProvider client={qc}>
        <catalogs.Probe />
        <agents.Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(catalogs.fetches()).toBe(1));
    await waitFor(() => expect(agents.fetches()).toBe(1));
    streamState.events["job-rn"] = [{ type: "exit", code: 0, durationMs: 1 }];
    act(() => {
      useActiveJobsStore.getState().push("job-rn", "agent.catalog-rename");
    });
    await waitFor(() => expect(catalogs.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(agents.fetches()).toBeGreaterThanOrEqual(2));
  });

  it("invalidates knowledge + agents on knowledge.* exit", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const knowledge = probeFor(qc, ["knowledge"]);
    const agents = probeFor(qc, ["agents"]);
    render(
      <QueryClientProvider client={qc}>
        <knowledge.Probe />
        <agents.Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(knowledge.fetches()).toBe(1));
    await waitFor(() => expect(agents.fetches()).toBe(1));
    streamState.events["job-kn"] = [{ type: "exit", code: 0, durationMs: 4 }];
    act(() => {
      useActiveJobsStore.getState().push("job-kn", "knowledge.add");
    });
    await waitFor(() => expect(knowledge.fetches()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(agents.fetches()).toBeGreaterThanOrEqual(2));
  });

  it("does NOT invalidate skill queries before exit fires", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const skills = probeFor(qc, ["skills"]);
    render(
      <QueryClientProvider client={qc}>
        <skills.Probe />
        <JobCompletionListener />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(skills.fetches()).toBe(1));
    streamState.events["job-pending"] = [{ type: "stdout", chunk: "installing...\n" }];
    act(() => {
      useActiveJobsStore.getState().push("job-pending", "skill.install");
    });
    // Give React Query a tick; should still be 1.
    await new Promise((r) => setTimeout(r, 50));
    expect(skills.fetches()).toBe(1);
  });
});
