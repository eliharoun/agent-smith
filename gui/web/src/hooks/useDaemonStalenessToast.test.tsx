import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { DaemonStatus } from "gui-shared";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import { useDaemonStalenessToast } from "./useDaemonStalenessToast";

function makeStatus(overrides: Partial<DaemonStatus> & { state: DaemonStatus["state"] }): DaemonStatus {
  return overrides as DaemonStatus;
}

let currentStatus: DaemonStatus = { state: "running", pid: 42, heartbeatAgeMs: 100 };

const server = setupServer(
  http.get("*/api/daemon/status", () => HttpResponse.json(currentStatus)),
);

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); currentStatus = { state: "running", pid: 42, heartbeatAgeMs: 100 }; });
afterAll(() => server.close());

beforeEach(() => { sessionStorage.setItem("smith.gui.token", "t"); });

function Host() {
  useDaemonStalenessToast();
  return null;
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return (
    <QueryClientProvider client={qc}>
      <NotificationCenter>{children}</NotificationCenter>
    </QueryClientProvider>
  );
}

describe("useDaemonStalenessToast", () => {
  it("fires no toast when daemon is running normally", async () => {
    currentStatus = { state: "running", pid: 42, heartbeatAgeMs: 100 };
    render(<Wrap><Host /></Wrap>);
    await waitFor(() => {}, { timeout: 200 });
    expect(document.querySelector('section[aria-label="notifications"]')?.textContent ?? "").toBe("");
  });

  it("fires a sticky error toast when daemon is stuck", async () => {
    currentStatus = { state: "stuck", pid: 42, heartbeatAgeMs: 20000 };
    render(<Wrap><Host /></Wrap>);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Daemon appears stuck/i);
    });
  });

  it("fires a sticky error toast when daemon has a stale pid", async () => {
    currentStatus = { state: "stale-pid", pid: 42 };
    render(<Wrap><Host /></Wrap>);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Daemon appears stuck/i);
    });
  });

  it("shows a Restart daemon action button", async () => {
    currentStatus = { state: "stuck", pid: 42, heartbeatAgeMs: 20000 };
    render(<Wrap><Host /></Wrap>);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Restart daemon/i);
    });
  });
});
