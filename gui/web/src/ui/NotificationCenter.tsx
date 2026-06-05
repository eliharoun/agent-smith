import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Notification, type NotificationAction, type NotificationKind } from "./Notification";

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  actions?: NotificationAction[];
  durationMs?: number | "sticky";
  dedupKey?: string;
}

export interface NotificationsApi {
  notify: (input: NotificationInput) => string;
  update: (id: string, patch: Partial<NotificationInput>) => void;
  dismiss: (id: string) => void;
}

interface InternalNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | undefined;
  actions: NotificationAction[] | undefined;
  durationMs: number | "sticky";
  dedupKey: string | undefined;
  // Timer accounting for hover-pause / resume.
  remainingMs: number;
  startedAt: number | null; // wall time when the current run started, null = paused
  timerHandle: number | null;
}

const MAX_VISIBLE = 4;

export const DEFAULT_DURATION: Record<NotificationKind, number | "sticky"> = {
  success: 3000,
  info: 5000,
  warning: "sticky",
  error: "sticky",
  progress: "sticky",
};

export const NotificationsContext = createContext<NotificationsApi | null>(null);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    // Fallback for older browsers (and our test mocks).
    mq.addListener?.(update);
    return () => mq.removeListener?.(update);
  }, []);
  return reduced;
}

export function NotificationCenter({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<InternalNotification[]>([]);
  const itemsRef = useRef<InternalNotification[]>([]);
  itemsRef.current = items;
  const idRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  const clearTimer = useCallback((n: InternalNotification) => {
    if (n.timerHandle !== null) {
      window.clearTimeout(n.timerHandle);
      n.timerHandle = null;
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setItems((prev) => {
        const found = prev.find((n) => n.id === id);
        if (found) clearTimer(found);
        return prev.filter((n) => n.id !== id);
      });
    },
    [clearTimer],
  );

  // Schedule a one-shot dismiss timer using `remainingMs`. No-op for sticky.
  const armTimer = useCallback(
    (n: InternalNotification) => {
      if (n.durationMs === "sticky") return;
      if (n.remainingMs <= 0) return;
      n.startedAt = Date.now();
      n.timerHandle = window.setTimeout(() => {
        dismiss(n.id);
      }, n.remainingMs);
    },
    [dismiss],
  );

  const pause = useCallback((id: string) => {
    setItems((prev) => {
      const next = [...prev];
      const idx = next.findIndex((n) => n.id === id);
      if (idx === -1) return prev;
      const n = next[idx];
      if (!n) return prev;
      if (n.durationMs === "sticky") return prev;
      if (n.timerHandle === null || n.startedAt === null) return prev;
      const elapsed = Date.now() - n.startedAt;
      window.clearTimeout(n.timerHandle);
      next[idx] = {
        ...n,
        remainingMs: Math.max(0, n.remainingMs - elapsed),
        startedAt: null,
        timerHandle: null,
      };
      return next;
    });
  }, []);

  const resume = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = [...prev];
        const idx = next.findIndex((n) => n.id === id);
        if (idx === -1) return prev;
        const n = next[idx];
        if (!n) return prev;
        if (n.durationMs === "sticky") return prev;
        if (n.timerHandle !== null) return prev; // already running
        const updated: InternalNotification = { ...n };
        armTimer(updated);
        next[idx] = updated;
        return next;
      });
    },
    [armTimer],
  );

  const notify = useCallback(
    (input: NotificationInput): string => {
      const duration = input.durationMs ?? DEFAULT_DURATION[input.kind];
      const numeric = duration === "sticky" ? 0 : duration;

      // Dedup path — if a visible notification has the same dedupKey, replace
      // in place: same id, reset content + timer.
      if (input.dedupKey) {
        const existing = itemsRef.current.find((n) => n.dedupKey === input.dedupKey);
        if (existing) {
          clearTimer(existing);
          const replaced: InternalNotification = {
            ...existing,
            kind: input.kind,
            title: input.title,
            body: input.body ?? undefined,
            actions: input.actions ?? undefined,
            durationMs: duration,
            remainingMs: numeric,
            startedAt: null,
            timerHandle: null,
          };
          armTimer(replaced);
          setItems((prev) => prev.map((n) => (n.id === existing.id ? replaced : n)));
          return existing.id;
        }
      }

      idRef.current += 1;
      const id = `notif-${idRef.current}`;
      const next: InternalNotification = {
        id,
        kind: input.kind,
        title: input.title,
        body: input.body ?? undefined,
        actions: input.actions ?? undefined,
        durationMs: duration,
        dedupKey: input.dedupKey ?? undefined,
        remainingMs: numeric,
        startedAt: null,
        timerHandle: null,
      };
      armTimer(next);
      setItems((prev) => {
        // FIFO eviction: oldest (head) goes first when over MAX_VISIBLE.
        const combined = [...prev, next];
        while (combined.length > MAX_VISIBLE) {
          const evicted = combined.shift();
          if (evicted) clearTimer(evicted);
        }
        return combined;
      });
      return id;
    },
    [armTimer, clearTimer],
  );

  const update = useCallback(
    (id: string, patch: Partial<NotificationInput>) => {
      setItems((prev) => {
        const next = [...prev];
        const idx = next.findIndex((n) => n.id === id);
        if (idx === -1) return prev;
        const cur = next[idx];
        if (!cur) return prev;
        clearTimer(cur);

        const newKind = patch.kind ?? cur.kind;
        // durationMs precedence:
        //   explicit patch.durationMs > kind-default-on-kind-change > current
        let newDuration: number | "sticky" = cur.durationMs;
        if (patch.durationMs !== undefined) {
          newDuration = patch.durationMs;
        } else if (patch.kind && patch.kind !== cur.kind) {
          newDuration = DEFAULT_DURATION[patch.kind];
        }
        const numeric = newDuration === "sticky" ? 0 : newDuration;

        const updated: InternalNotification = {
          ...cur,
          kind: newKind,
          title: patch.title ?? cur.title,
          body: patch.body !== undefined ? patch.body : cur.body,
          actions: patch.actions !== undefined ? patch.actions : cur.actions,
          durationMs: newDuration,
          remainingMs: numeric,
          startedAt: null,
          timerHandle: null,
        };
        // Restart timer if any timing-relevant field changed (kind transition
        // or explicit duration). If neither was provided, keep the prior
        // remainingMs by writing it back unchanged.
        if (patch.durationMs === undefined && (!patch.kind || patch.kind === cur.kind)) {
          updated.remainingMs = cur.remainingMs;
        }
        armTimer(updated);
        next[idx] = updated;
        return next;
      });
    },
    [armTimer, clearTimer],
  );

  // Cleanup any outstanding timers when the provider unmounts.
  useEffect(() => {
    const ref = itemsRef;
    return () => {
      for (const n of ref.current) {
        if (n.timerHandle !== null) window.clearTimeout(n.timerHandle);
      }
    };
  }, []);

  const api = useMemo<NotificationsApi>(
    () => ({ notify, update, dismiss }),
    [notify, update, dismiss],
  );

  return (
    <NotificationsContext.Provider value={api}>
      {children}
      {/* Stack — newest on top by reversing the array; bottom-right fixed. */}
      <section
        aria-label="notifications"
        className="fixed bottom-4 right-4 z-50 flex flex-col-reverse items-end gap-2 pointer-events-none"
      >
        {items.map((n) => (
          <Notification
            key={n.id}
            id={n.id}
            kind={n.kind}
            title={n.title}
            body={n.body}
            actions={n.actions}
            onDismiss={dismiss}
            onPause={pause}
            onResume={resume}
            reducedMotion={reducedMotion}
          />
        ))}
      </section>
    </NotificationsContext.Provider>
  );
}
