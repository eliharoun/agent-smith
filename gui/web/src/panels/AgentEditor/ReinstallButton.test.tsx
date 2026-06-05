import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@/lib/job-events";
import { useActiveJobsStore } from "@/store/active-jobs";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { ReinstallButton } from "./ReinstallButton";

const streamState: { events: Record<string, JobEvent[]> } = { events: {} };

vi.mock("@/hooks/useJobStream", () => ({
  useJobStream: (jobId: string | undefined) => (jobId ? (streamState.events[jobId] ?? []) : []),
}));

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  sessionStorage.setItem("smith.gui.token", "t");
  streamState.events = {};
  useActiveJobsStore.setState({ active: [], commands: {}, exits: {} });
});

function renderBtn(agent = "foo") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <NotificationCenter>{children}</NotificationCenter>
      </QueryClientProvider>
    );
  }
  return render(
    <Wrap>
      <ReinstallButton agent={agent} />
    </Wrap>,
  );
}

const noEntries = () =>
  http.get("*/api/agents/:name/install-state", () => HttpResponse.json({ entries: [] }));
const noDrift = () =>
  http.get("*/api/agents/:name/drift-check", () => HttpResponse.json({ drifted: [] }));

describe("ReinstallButton", () => {
  it("renders nothing when no platform is installed", async () => {
    server.use(noEntries(), noDrift());
    renderBtn();
    // Wait a tick for queries to settle.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /re-install/i })).not.toBeInTheDocument(),
    );
  });

  it("renders the button without a drift dot when drift is empty", async () => {
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "claude-code",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      noDrift(),
    );
    renderBtn();
    const btn = await screen.findByRole("button", { name: /re-install/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByTestId("reinstall-drift-dot")).not.toBeInTheDocument();
    // Subtitle lists the installed platforms.
    expect(screen.getByText(/claude-code/)).toBeInTheDocument();
  });

  it("renders a drift dot + tooltip wiring when drift is non-empty", async () => {
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "claude-code",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
            {
              platform: "kiro",
              path: "/y",
              contentHash: "sha256:b",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["claude-code"] }),
      ),
    );
    renderBtn();
    await screen.findByRole("button", { name: /re-install/i });
    expect(await screen.findByTestId("reinstall-drift-dot")).toBeInTheDocument();
  });

  it("clicking dispatches with drifted-only targets", async () => {
    const postSpy = vi.fn();
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "claude-code",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
            {
              platform: "kiro",
              path: "/y",
              contentHash: "sha256:b",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["claude-code"] }),
      ),
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j-1", preview: "" });
      }),
    );
    renderBtn();
    const btn = await screen.findByRole("button", { name: /re-install/i });
    fireEvent.click(btn);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy.mock.calls[0]?.[0]).toMatchObject({
      command: "agent.install",
      name: "foo",
      platforms: ["claude-code"],
    });
  });

  it("clicking with no drift dispatches with all installed targets", async () => {
    const postSpy = vi.fn();
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "claude-code",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
            {
              platform: "kiro",
              path: "/y",
              contentHash: "sha256:b",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      noDrift(),
      http.post("*/api/jobs", async ({ request }) => {
        postSpy(await request.json());
        return HttpResponse.json({ jobId: "j-1", preview: "" });
      }),
    );
    renderBtn();
    const btn = await screen.findByRole("button", { name: /re-install/i });
    fireEvent.click(btn);
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const platforms = postSpy.mock.calls[0]?.[0]?.platforms as string[];
    expect(platforms.sort()).toEqual(["claude-code", "kiro"]);
  });

  it("disables and shows Re-installing… label while pending", async () => {
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "opencode",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      noDrift(),
      http.post("*/api/jobs", () => HttpResponse.json({ jobId: "j-1", preview: "" })),
    );
    renderBtn();
    const btn = await screen.findByRole("button", { name: /re-install/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-install/i })).toBeDisabled();
    });
    expect(
      (screen.getByRole("button", { name: /re-install/i }).textContent ?? "").toLowerCase(),
    ).toContain("re-installing");
  });

  it("ignores sidecar entries when computing installed platforms", async () => {
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "codex",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "sidecar",
            },
          ],
        }),
      ),
      noDrift(),
    );
    renderBtn();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /re-install/i })).not.toBeInTheDocument(),
    );
  });

  it("the drift dot is described by an accessible tooltip text", async () => {
    server.use(
      http.get("*/api/agents/foo/install-state", () =>
        HttpResponse.json({
          entries: [
            {
              platform: "claude-code",
              path: "/x",
              contentHash: "sha256:a",
              installedAt: "2024-01-01T00:00:00Z",
              kind: "main",
            },
          ],
        }),
      ),
      http.get("*/api/agents/foo/drift-check", () =>
        HttpResponse.json({ drifted: ["claude-code"] }),
      ),
    );
    const { container } = renderBtn();
    const dot = await screen.findByTestId("reinstall-drift-dot");
    expect(dot).toBeInTheDocument();
    // The dot has an accessible label naming the out-of-date platforms.
    expect(within(container).getByLabelText(/claude-code is out of date/i)).toBeInTheDocument();
  });
});
