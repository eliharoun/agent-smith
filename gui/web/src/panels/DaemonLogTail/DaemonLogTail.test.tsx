import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    }, 0);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((f) => f !== fn),
    );
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string, data: string) {
    const ev = new MessageEvent(type, { data });
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

let originalEventSource: typeof EventSource;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  MockEventSource.instances = [];
  // biome-ignore lint/suspicious/noExplicitAny: test-only mock
  (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

vi.mock("@/api/client", () => ({
  getToken: () => "tok-test",
}));

import { DaemonLogTail } from "./DaemonLogTail";

function currentEs(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]!;
}

describe("DaemonLogTail", () => {
  it("opens an EventSource against /api/daemon/log/stream with token", () => {
    render(<DaemonLogTail />);
    expect(currentEs().url).toMatch(/\/api\/daemon\/log\/stream\?token=tok-test/);
  });

  it("renders streamed lines and filters them by regex", async () => {
    render(<DaemonLogTail />);
    const es = currentEs();
    act(() => {
      es.emit("line", "INFO start");
      es.emit("line", "ERROR oops");
      es.emit("line", "INFO heartbeat");
    });
    expect(await screen.findByText("INFO start")).toBeInTheDocument();
    expect(screen.getByText("ERROR oops")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("filter regex…"), {
      target: { value: "ERROR" },
    });
    expect(screen.queryByText("INFO start")).not.toBeInTheDocument();
    expect(screen.getByText("ERROR oops")).toBeInTheDocument();
  });

  it("renders truncation banner on truncated event", async () => {
    render(<DaemonLogTail />);
    act(() => {
      currentEs().emit("truncated", "");
    });
    expect(await screen.findByText(/log rotated or shrank/)).toBeInTheDocument();
  });

  it("caps buffer at MAX_LINES (500)", async () => {
    render(<DaemonLogTail />);
    act(() => {
      const es = currentEs();
      for (let i = 0; i < 600; i++) es.emit("line", `line ${i}`);
    });
    await waitFor(() => {
      expect(screen.queryByText("line 0")).not.toBeInTheDocument();
      expect(screen.getByText("line 599")).toBeInTheDocument();
    });
  });
});
