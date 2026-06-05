import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { Platform } from "gui-shared";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { type ReactNode, useEffect } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";
import { useActiveJobsStore } from "@/store/active-jobs";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { driftCheckKey } from "./useDriftCheck";
import { installStateKey } from "./useInstallState";
import { useReinstall } from "./useReinstall";

// Per-test mutable map of jobId -> events. The mocked useJobStream reads from this.
const streamState: { events: Record<string, JobEvent[]> } = { events: {} };

vi.mock("@/hooks/useJobStream", () => ({
  useJobStream: (jobId: string | undefined) => (jobId ? (streamState.events[jobId] ?? []) : []),
}));

const server = setupServer(
  http.post("*/api/jobs", () => HttpResponse.json({ jobId: "j-1", preview: "" })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  streamState.events = {};
  useActiveJobsStore.setState({ active: [], commands: {}, exits: {} });
});

interface HookResult {
  reinstall: (targets: Platform[]) => void;
  isPending: boolean;
}

function Harness({
  agent,
  onReady,
}: {
  agent: string;
  onReady: (api: HookResult) => void;
}) {
  const api = useReinstall(agent);
  // Always update so tests can read the latest isPending after re-renders.
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

function renderHarness(agent: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let api: HookResult | null = null;
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <NotificationCenter>{children}</NotificationCenter>
      </QueryClientProvider>
    );
  }
  const utils = render(
    <Wrap>
      <Harness
        agent={agent}
        onReady={(a) => {
          api = a;
        }}
      />
    </Wrap>,
  );
  return { qc, utils, getApi: (): HookResult => api as HookResult };
}

describe("useReinstall", () => {
  it("dispatches agent.install with the requested platforms", async () => {
    const postSpy = vi.fn();
    server.use(
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j-1", preview: "" });
      }),
    );
    const { getApi } = renderHarness("foo");
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => {
      getApi().reinstall(["claude-code", "kiro"]);
    });
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const body = postSpy.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      command: "agent.install",
      name: "foo",
      platforms: ["claude-code", "kiro"],
      withSkills: false,
    });
  });

  it("transitions notification from progress to success on job exit code 0", async () => {
    const { getApi } = renderHarness("foo");
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => {
      getApi().reinstall(["opencode"]);
    });
    // Progress notification appears (the section has aria-label="notifications";
    // the implicit ARIA role for <section> with an accessible name is "region").
    await waitFor(() =>
      expect(
        document.querySelector('section[aria-label="notifications"]'),
      ).toBeTruthy(),
    );
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Re-installing/i);
    });
    // Job emits exit 0.
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => {
      // Trigger re-render by re-pushing the same job (the active-jobs store
      // is the source of truth; useReinstall's effect re-runs on change).
      useActiveJobsStore.getState().push("j-1", "agent.install");
    });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Re-installed/i);
    });
  });

  it("transitions notification to error on non-zero exit code", async () => {
    const { getApi } = renderHarness("foo");
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => {
      getApi().reinstall(["opencode"]);
    });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [
      { type: "stderr", chunk: "boom: something went wrong\n" },
      { type: "exit", code: 1, durationMs: 5 },
    ];
    act(() => {
      useActiveJobsStore.getState().push("j-1", "agent.install");
    });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Re-install failed/i);
    });
  });

  it("invalidates drift-check + install-state queries on success", async () => {
    const { qc, getApi } = renderHarness("foo");
    await waitFor(() => expect(getApi()).not.toBeNull());
    const spy = vi.spyOn(qc, "invalidateQueries");
    act(() => {
      getApi().reinstall(["opencode"]);
    });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => {
      useActiveJobsStore.getState().push("j-1", "agent.install");
    });
    await waitFor(() => {
      const driftCalls = spy.mock.calls.filter((c) => {
        const k = c[0]?.queryKey;
        return Array.isArray(k) && JSON.stringify(k) === JSON.stringify(driftCheckKey("foo"));
      });
      expect(driftCalls.length).toBeGreaterThan(0);
    });
    const stateCalls = spy.mock.calls.filter((c) => {
      const k = c[0]?.queryKey;
      return Array.isArray(k) && JSON.stringify(k) === JSON.stringify(installStateKey("foo"));
    });
    expect(stateCalls.length).toBeGreaterThan(0);
  });

  it("isPending is true between dispatch and exit", async () => {
    const apiBox: { current: HookResult | null } = { current: null };
    function Capturer({ agent }: { agent: string }) {
      const api = useReinstall(agent);
      apiBox.current = api;
      return null;
    }
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <NotificationCenter>
          <Capturer agent="foo" />
        </NotificationCenter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(apiBox.current).not.toBeNull());
    expect(apiBox.current?.isPending).toBe(false);
    act(() => {
      apiBox.current?.reinstall(["opencode"]);
    });
    await waitFor(() => expect(apiBox.current?.isPending).toBe(true));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => {
      useActiveJobsStore.getState().push("j-1", "agent.install");
    });
    await waitFor(() => expect(apiBox.current?.isPending).toBe(false));
  });
});
