import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "../hooks/useNotifications";
import { NotificationCenter } from "./NotificationCenter";

/**
 * Notification primitive — bottom-right stack of transient feedback cards.
 * The hook is the only public surface; <Notification> is presentational and
 * tested through the provider so wiring (timer, dedup, FIFO) is covered too.
 */

function Wrap({ children }: { children: ReactNode }) {
  return <NotificationCenter>{children}</NotificationCenter>;
}

function Trigger({ onReady }: { onReady: (api: ReturnType<typeof useNotifications>) => void }) {
  const api = useNotifications();
  const captured = useRef(false);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    onReady(api);
  }, [api, onReady]);
  return null;
}

describe("Notification kinds", () => {
  it("renders success with check glyph and status role", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "success", title: "Saved" });
    });
    const region = screen.getByRole("region", { name: /notifications/i });
    const notif = within(region).getByRole("status");
    expect(notif).toHaveTextContent("Saved");
    expect(notif.textContent).toContain("✓");
    expect(notif.className).toMatch(/border-matrix-green/);
  });

  it("renders info with right glyph and muted border", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "Heads up" });
    });
    const notif = screen.getByRole("status");
    expect(notif.textContent).toContain("▸");
    expect(notif.className).toMatch(/border-matrix-green-muted/);
  });

  it("renders warning with alert role + amber border", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "warning", title: "Restart needed" });
    });
    const notif = screen.getByRole("alert");
    expect(notif.textContent).toContain("⚠");
    expect(notif.className).toMatch(/border-matrix-amber/);
  });

  it("renders error with alert role + red border", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "error", title: "Refresh failed" });
    });
    const notif = screen.getByRole("alert");
    expect(notif.textContent).toContain("✗");
    expect(notif.className).toMatch(/border-matrix-red/);
  });

  it("renders progress with spinner glyph and status role", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "progress", title: "Re-installing…" });
    });
    const notif = screen.getByRole("status");
    expect(notif.textContent).toContain("⟳");
  });
});

describe("Notification body & actions", () => {
  it("renders body text when provided", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "Saved", body: "Re-install on cursor." });
    });
    expect(screen.getByText("Re-install on cursor.")).toBeInTheDocument();
  });

  it("renders action buttons and invokes onClick + dismisses on click", () => {
    let api!: ReturnType<typeof useNotifications>;
    const onClick = vi.fn();
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({
        kind: "warning",
        title: "Restart",
        actions: [{ label: "Re-install", onClick }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: /re-install/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Notification dismissal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses success after default 3000ms", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "success", title: "Saved" });
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not auto-dismiss when durationMs is 'sticky'", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "Stays", durationMs: "sticky" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("honors custom durationMs", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "Briefly", durationMs: 8000 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses timer on hover, resumes on mouseleave", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "success", title: "Saved" });
    });
    const notif = screen.getByRole("status");
    // advance 1s then hover — remaining 2s should NOT fire while hovered
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.mouseEnter(notif);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.mouseLeave(notif);
    // After mouseleave, the remaining ~2s resume
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dismisses on Esc when focused inside the notification", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "warning", title: "Sticky" });
    });
    const notif = screen.getByRole("alert");
    fireEvent.keyDown(notif, { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses on close button click", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "warning", title: "Sticky" });
    });
    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports programmatic dismiss(id)", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    let id = "";
    act(() => {
      id = api.notify({ kind: "warning", title: "Sticky" });
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => {
      api.dismiss(id);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Notification dedup & FIFO", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dedup replaces existing notification with same dedupKey", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "First", dedupKey: "agent-saved" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => {
      api.notify({ kind: "info", title: "Second", dedupKey: "agent-saved" });
    });
    const notifs = screen.getAllByRole("status");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toHaveTextContent("Second");
    // timer should have reset — original 5000 - 2000 = 3000 elapsed wouldn't yet
    // expire, but if reset it has a fresh 5000. Advance 4000 — must still be visible.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("evicts oldest when 5th notification arrives (max 4)", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "warning", title: "A" });
      api.notify({ kind: "warning", title: "B" });
      api.notify({ kind: "warning", title: "C" });
      api.notify({ kind: "warning", title: "D" });
    });
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    act(() => {
      api.notify({ kind: "warning", title: "E" });
    });
    const visible = screen.getAllByRole("alert");
    expect(visible).toHaveLength(4);
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
  });
});

describe("Notification update()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mutates a live notification's fields", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    let id = "";
    act(() => {
      id = api.notify({ kind: "progress", title: "Re-installing…" });
    });
    expect(screen.getByText("Re-installing…")).toBeInTheDocument();
    act(() => {
      api.update(id, { kind: "success", title: "Re-installed" });
    });
    expect(screen.queryByText("Re-installing…")).not.toBeInTheDocument();
    expect(screen.getByText("Re-installed")).toBeInTheDocument();
  });

  it("applies new kind's default duration when transitioning from progress", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    let id = "";
    act(() => {
      id = api.notify({ kind: "progress", title: "Working" });
    });
    // Progress is sticky-until-mutated — wait a long time, still there.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      api.update(id, { kind: "success", title: "Done" });
    });
    // success default 3000ms — should auto-dismiss now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("restarts timer when durationMs given in update", async () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    let id = "";
    act(() => {
      id = api.notify({ kind: "info", title: "Foo" }); // default 5000
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    act(() => {
      api.update(id, { durationMs: 2000 });
    });
    // 4000 already elapsed but timer reset to 2000 → still visible until 2000 more
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Notification a11y & motion", () => {
  it("container has role=region and aria-label", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "x" });
    });
    const region = screen.getByRole("region", { name: /notifications/i });
    expect(region).toBeInTheDocument();
  });

  it("dismiss button has aria-label", () => {
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "warning", title: "x" });
    });
    expect(screen.getByRole("button", { name: /dismiss notification/i })).toBeInTheDocument();
  });

  it("skips animation class when prefers-reduced-motion is set", () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    let api!: ReturnType<typeof useNotifications>;
    render(
      <Wrap>
        <Trigger onReady={(a) => (api = a)} />
      </Wrap>,
    );
    act(() => {
      api.notify({ kind: "info", title: "x" });
    });
    const notif = screen.getByRole("status");
    // Without reduced motion, the slide-in class would be applied; with it, not.
    expect(notif.className).not.toMatch(/animate-/);
    window.matchMedia = realMatchMedia;
  });
});
