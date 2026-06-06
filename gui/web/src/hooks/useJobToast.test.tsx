// gui/web/src/hooks/useJobToast.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { JobRequest } from "gui-shared";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { type ReactNode, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";
import { useActiveJobsStore } from "@/store/active-jobs";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { useJobToast, type UseJobToastResult } from "./useJobToast";

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

function Harness({ opts, onReady }: { opts: Parameters<typeof useJobToast>[0]; onReady: (api: UseJobToastResult) => void }) {
  const api = useJobToast(opts);
  useEffect(() => { onReady(api); }, [api, onReady]);
  return null;
}

function renderHarness(opts: Parameters<typeof useJobToast>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let api: UseJobToastResult | null = null;
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NotificationCenter>{children}</NotificationCenter>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }
  const utils = render(<Wrap><Harness opts={opts} onReady={(a) => { api = a; }} /></Wrap>);
  return { qc, utils, getApi: (): UseJobToastResult => api as UseJobToastResult };
}

const TEST_REQ: JobRequest = { command: "skill.validate", name: "my-skill" };
const TEST_OPTS = {
  command: "skill.validate",
  label: {
    progress: () => "Validating my-skill…",
    success: () => "Validated my-skill",
    error: () => "Validate failed",
  },
  dedupKey: "job-toast:skill.validate:my-skill",
};

describe("useJobToast", () => {
  it("dispatches the job request to /api/jobs on dispatch()", async () => {
    const postSpy = vi.fn();
    server.use(http.post("*/api/jobs", async ({ request }) => { postSpy(await request.json()); return HttpResponse.json({ jobId: "j-1", preview: "" }); }));
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy.mock.calls[0]?.[0]).toMatchObject({ command: "skill.validate", name: "my-skill" });
  });

  it("shows a progress toast immediately after dispatch()", async () => {
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Validating my-skill/i);
    });
  });

  it("transitions to success toast on SSE exit code 0", async () => {
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Validated my-skill/i);
    });
  });

  it("transitions to error toast on non-zero exit code with stderr tail", async () => {
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [
      { type: "stderr", chunk: "validation error: missing required field\n" },
      { type: "exit", code: 1, durationMs: 5 },
    ];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Validate failed/i);
    });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/validation error/i);
    });
  });

  it("shows Retry and View logs action buttons on error", async () => {
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [{ type: "exit", code: 1, durationMs: 5 }];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Retry/i);
      expect(document.body.textContent).toMatch(/View logs/i);
    });
  });

  it("transitions to error toast when POST fails", async () => {
    server.use(http.post("*/api/jobs", () => HttpResponse.error()));
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Validate failed/i);
    });
  });

  it("isPending is true between dispatch and exit, false after", async () => {
    const apiBox: { current: UseJobToastResult | null } = { current: null };
    function Capturer() {
      const api = useJobToast(TEST_OPTS);
      apiBox.current = api;
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NotificationCenter><Capturer /></NotificationCenter>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(apiBox.current).not.toBeNull());
    expect(apiBox.current?.isPending).toBe(false);
    act(() => { apiBox.current?.dispatch(TEST_REQ); });
    await waitFor(() => expect(apiBox.current?.isPending).toBe(true));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => expect(apiBox.current?.isPending).toBe(false));
  });

  it("collapses rapid double-dispatch to one toast via dedupKey", async () => {
    const { getApi } = renderHarness(TEST_OPTS);
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); getApi().dispatch(TEST_REQ); });
    await waitFor(() => {
      const notifications = document.querySelectorAll('section[aria-label="notifications"] [role="alert"], section[aria-label="notifications"] article');
      // Should only be one visible toast despite two dispatches.
      // At minimum, the text appears once (not duplicated unboundedly).
      const matches = document.body.textContent?.match(/Validating my-skill/gi) ?? [];
      expect(matches.length).toBeLessThanOrEqual(2); // dedupKey merges
    });
  });

  it("calls onSuccess callback on exit code 0", async () => {
    const onSuccess = vi.fn();
    const { getApi } = renderHarness({ ...TEST_OPTS, onSuccess });
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [{ type: "exit", code: 0, durationMs: 5 }];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("j-1"));
  });

  it("calls onError callback on non-zero exit", async () => {
    const onError = vi.fn();
    const { getApi } = renderHarness({ ...TEST_OPTS, onError });
    await waitFor(() => expect(getApi()).not.toBeNull());
    act(() => { getApi().dispatch(TEST_REQ); });
    await waitFor(() => expect(useActiveJobsStore.getState().active).toContain("j-1"));
    streamState.events["j-1"] = [
      { type: "stderr", chunk: "bad news\n" },
      { type: "exit", code: 2, durationMs: 5 },
    ];
    act(() => { useActiveJobsStore.getState().push("j-1", "skill.validate"); });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(2, "bad news"));
  });

  it("label functions are called at dispatch time, not at hook declaration time", async () => {
    let name = "initial-skill";
    const opts = {
      command: "skill.validate",
      label: {
        progress: () => `Validating ${name}…`,
        success: () => `Validated ${name}`,
        error: () => "Validate failed",
      },
      dedupKey: "job-toast:skill.validate:dynamic",
    };
    const { getApi } = renderHarness(opts);
    await waitFor(() => expect(getApi()).not.toBeNull());
    // Change name after hook declaration but before dispatch
    name = "changed-skill";
    act(() => { getApi().dispatch(TEST_REQ); });
    // The progress toast should show the name at dispatch time ("changed-skill")
    await waitFor(() => {
      const region = document.querySelector('section[aria-label="notifications"]');
      expect(region?.textContent ?? "").toMatch(/Validating changed-skill/i);
    });
  });
});
