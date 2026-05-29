import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({ mutate, mutateAsync, isPending: false }),
}));

const refetch = vi.fn().mockResolvedValue({ data: { state: "not-running" } });
let statusData: unknown = { state: "running", pid: 42, heartbeatAgeMs: 200 };
vi.mock("@/hooks/useDaemonStatus", () => ({
  useDaemonStatus: () => ({
    data: statusData,
    isLoading: false,
    isError: false,
    refetch,
  }),
}));

import { DaemonControl } from "./DaemonControl";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("DaemonControl", () => {
  beforeEach(() => {
    mutate.mockClear();
    mutateAsync.mockClear();
    refetch.mockClear();
    statusData = { state: "running", pid: 42, heartbeatAgeMs: 200 };
  });

  it("renders RUNNING chip with pid + heartbeat", () => {
    render(wrap(<DaemonControl />));
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(screen.getByText(/pid 42/)).toBeInTheDocument();
    expect(screen.getByText(/heartbeat 200ms ago/)).toBeInTheDocument();
  });

  it("when running: start disabled, stop enabled", () => {
    render(wrap(<DaemonControl />));
    expect(screen.getByRole("button", { name: /^start$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^stop$/ })).toBeEnabled();
  });

  it("when not-running: start enabled, stop disabled", () => {
    statusData = { state: "not-running" };
    render(wrap(<DaemonControl />));
    expect(screen.getByRole("button", { name: /^start$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^stop$/ })).toBeDisabled();
  });

  it("dispatches daemon.stop on stop click", () => {
    render(wrap(<DaemonControl />));
    fireEvent.click(screen.getByRole("button", { name: /^stop$/ }));
    expect(mutate).toHaveBeenCalledWith({ command: "daemon.stop" });
  });

  it("renders STUCK chip for stuck state", () => {
    statusData = { state: "stuck", pid: 99, heartbeatAgeMs: 30000 };
    render(wrap(<DaemonControl />));
    expect(screen.getByText("STUCK")).toBeInTheDocument();
    expect(screen.getByText(/heartbeat 30s ago/)).toBeInTheDocument();
  });

  it("restart sequences stop -> wait -> start", async () => {
    render(wrap(<DaemonControl />));
    fireEvent.click(screen.getByRole("button", { name: /^restart$/ }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ command: "daemon.stop" });
      expect(mutateAsync).toHaveBeenCalledWith({ command: "daemon.start" });
    });
  });
});
