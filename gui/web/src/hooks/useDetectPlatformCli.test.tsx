// gui/web/src/hooks/useDetectPlatformCli.test.tsx
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "@/ui/NotificationCenter";
import type { PendingOp } from "../../../../src/io/pending-ops";

// ── mutable seams ─────────────────────────────────────────────────────────────

let detectedPlatforms: string[] = [];
let pendingOps: PendingOp[] = [];

vi.mock("./useDetectedPlatforms", () => ({
  useDetectedPlatforms: () => ({
    data: { detected: detectedPlatforms },
  }),
}));

vi.mock("@/api/platforms", () => ({
  platformsApi: {
    detected: vi.fn(),
  },
  pendingOpsApi: {
    list: () => Promise.resolve({ ops: pendingOps }),
  },
}));

vi.mock("@/hooks/useStartJob", () => ({
  useStartJob: () => ({
    mutate: vi.fn(),
  }),
}));

// Import after mocks are hoisted.
import { useDetectPlatformCli } from "./useDetectPlatformCli";

// ── wrapper ───────────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: ReactNode }) => (
  <NotificationCenter>{children}</NotificationCenter>
);

function notificationsText() {
  return document.querySelector('section[aria-label="notifications"]')?.textContent ?? "";
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  detectedPlatforms = [];
  pendingOps = [];
});

afterEach(() => {
  detectedPlatforms = [];
  pendingOps = [];
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useDetectPlatformCli", () => {
  it("fires no toast on first mount (baseline set)", () => {
    detectedPlatforms = ["claude-code"];
    renderHook(() => useDetectPlatformCli(), { wrapper });
    expect(notificationsText()).not.toMatch(/New platform detected/i);
  });

  it("fires no toast when a known platform stays available across renders", () => {
    detectedPlatforms = ["claude-code"];
    const { rerender } = renderHook(() => useDetectPlatformCli(), { wrapper });
    // Baseline set; same set on next poll — no toast.
    act(() => {
      detectedPlatforms = ["claude-code"];
    });
    rerender();
    expect(notificationsText()).not.toMatch(/New platform detected/i);
  });

  it("fires no toast when a newly-detected platform has no pending ops", async () => {
    detectedPlatforms = [];
    pendingOps = [];
    const { rerender } = renderHook(() => useDetectPlatformCli(), { wrapper });
    // After baseline, the platform appears but has no pending ops.
    act(() => {
      detectedPlatforms = ["claude-code"];
    });
    rerender();
    // Wait for the async pendingOpsApi.list() to settle.
    await act(async () => {});
    expect(notificationsText()).not.toMatch(/New platform detected/i);
  });

  it("fires an info toast with a Replay action when pending ops exist for a newly-detected platform", async () => {
    detectedPlatforms = [];
    pendingOps = [
      {
        schemaVersion: 1,
        agent: "foo",
        command: "agent.install",
        platform: "claude-code",
        queuedAt: "2026-06-05T00:00:00Z",
        manifestTargetAtQueue: ["claude-code"],
      },
    ];
    const { rerender } = renderHook(() => useDetectPlatformCli(), { wrapper });
    // Baseline = []; now claude-code appears.
    act(() => {
      detectedPlatforms = ["claude-code"];
    });
    rerender();
    await act(async () => {});
    expect(notificationsText()).toMatch(/New platform detected/i);
    expect(notificationsText()).toMatch(/Replay 1 install/i);
  });

  it("shows aggregate count in the toast body when multiple ops are queued", async () => {
    detectedPlatforms = [];
    pendingOps = [
      {
        schemaVersion: 1,
        agent: "foo",
        command: "agent.install",
        platform: "claude-code",
        queuedAt: "2026-06-05T00:00:00Z",
        manifestTargetAtQueue: ["claude-code"],
      },
      {
        schemaVersion: 1,
        agent: "bar",
        command: "agent.install",
        platform: "claude-code",
        queuedAt: "2026-06-05T00:00:01Z",
        manifestTargetAtQueue: ["claude-code"],
      },
    ];
    const { rerender } = renderHook(() => useDetectPlatformCli(), { wrapper });
    act(() => {
      detectedPlatforms = ["claude-code"];
    });
    rerender();
    await act(async () => {});
    expect(notificationsText()).toMatch(/Replay 2 installs/i);
  });

  it("ignores pending ops for platforms that were already in the baseline", async () => {
    detectedPlatforms = ["codex"];
    pendingOps = [
      {
        schemaVersion: 1,
        agent: "baz",
        command: "agent.install",
        platform: "codex",
        queuedAt: "2026-06-05T00:00:00Z",
        manifestTargetAtQueue: ["codex"],
      },
    ];
    const { rerender } = renderHook(() => useDetectPlatformCli(), { wrapper });
    // Baseline = ["codex"]; same on re-render — no transition.
    act(() => {
      detectedPlatforms = ["codex"];
    });
    rerender();
    await act(async () => {});
    // codex was in baseline, so no toast even though ops exist.
    expect(notificationsText()).not.toMatch(/New platform detected/i);
  });
});
