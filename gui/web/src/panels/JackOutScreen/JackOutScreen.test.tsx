import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mocks ────────────────────────────────────────────────────────
type DryData = undefined | { rawOutput: string; lines: string[] };
let dryData: DryData;
let dryError: unknown = null;
vi.mock("@/hooks/useJackOutDryRun", () => ({
  useJackOutDryRun: () => ({
    data: dryData,
    isLoading: dryData === undefined && !dryError,
    error: dryError,
  }),
}));

const startSpy = vi.fn<() => Promise<{ jobId: string }>>();
vi.mock("@/api/jobs", () => ({
  jobsApi: {
    start: (...args: unknown[]) => startSpy(...(args as [])),
    streamUrl: (id: string) => `/api/jobs/${id}/stream`,
  },
}));

// MatrixRain depends on canvas APIs that jsdom doesn't implement; stub it.
vi.mock("@/ui/MatrixRain", () => ({
  MatrixRain: () => <div data-testid="matrix-rain" />,
}));

// jsdom has no EventSource; stub the global with a no-op class so the
// state-machine `subscribe()` call doesn't throw during the spawn path.
class MockEventSource {
  url: string;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

import { JackOutScreen } from "./JackOutScreen";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("JackOutScreen", () => {
  beforeEach(() => {
    dryData = {
      rawOutput:
        "This will permanently remove:\n\n    /home/u/.agent-smith\n    /home/u/.claude/agents/foo.md\n",
      lines: ["    /home/u/.agent-smith", "    /home/u/.claude/agents/foo.md"],
    };
    dryError = null;
    startSpy.mockReset();
    startSpy.mockResolvedValue({ jobId: "jo1" });
  });

  it("renders dry-run rawOutput on mount", () => {
    render(wrap(<JackOutScreen />));
    expect(screen.getByText(/~?\/home\/u\/\.agent-smith/)).toBeInTheDocument();
    expect(screen.getByText(/exact removal target \(2 paths\)/i)).toBeInTheDocument();
  });

  it("disables continue while dry-run is loading", () => {
    dryData = undefined;
    render(wrap(<JackOutScreen />));
    expect(screen.getByRole("button", { name: /continue/ })).toBeDisabled();
  });

  it("opens confirm modal on continue and requires exact 'jack-out' token", () => {
    render(wrap(<JackOutScreen />));
    fireEvent.click(screen.getByRole("button", { name: /continue/ }));
    expect(screen.getByText(/Type the exact phrase/)).toBeInTheDocument();
    const input = screen.getByLabelText(/type "jack-out"/);
    fireEvent.change(input, { target: { value: "jack out" } }); // wrong (space)
    expect(screen.getByRole("button", { name: "Jack Out" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "jack-out" } });
    expect(screen.getByRole("button", { name: "Jack Out" })).toBeEnabled();
  });

  it("dispatches jack-out job and transitions to running", async () => {
    render(wrap(<JackOutScreen />));
    fireEvent.click(screen.getByRole("button", { name: /continue/ }));
    const input = screen.getByLabelText(/type "jack-out"/);
    fireEvent.change(input, { target: { value: "jack-out" } });
    fireEvent.click(screen.getByRole("button", { name: "Jack Out" }));
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("matrix-rain")).toBeInTheDocument());
  });

  it("cancel returns to warning stage", () => {
    render(wrap(<JackOutScreen />));
    fireEvent.click(screen.getByRole("button", { name: /continue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Type the exact phrase/)).not.toBeInTheDocument();
  });
});
