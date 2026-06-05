import { type KeyboardEvent, useEffect, useRef, useState } from "react";

export type NotificationKind = "success" | "info" | "warning" | "error" | "progress";

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
}

export interface NotificationViewProps {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | undefined;
  actions: NotificationAction[] | undefined;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  reducedMotion: boolean;
}

const GLYPH: Record<NotificationKind, string> = {
  success: "✓",
  info: "▸",
  warning: "⚠",
  error: "✗",
  progress: "⟳",
};

const BORDER: Record<NotificationKind, string> = {
  success: "border-matrix-green text-matrix-green",
  info: "border-matrix-green-muted text-matrix-green-muted",
  warning: "border-matrix-amber text-matrix-amber",
  error: "border-matrix-red text-matrix-red",
  progress: "border-matrix-green-muted text-matrix-green-muted",
};

const ROLE: Record<NotificationKind, "status" | "alert"> = {
  success: "status",
  info: "status",
  warning: "alert",
  error: "alert",
  progress: "status",
};

const ARIA_LIVE: Record<NotificationKind, "polite" | "assertive"> = {
  success: "polite",
  info: "polite",
  warning: "assertive",
  error: "assertive",
  progress: "polite",
};

export function Notification({
  id,
  kind,
  title,
  body,
  actions,
  onDismiss,
  onPause,
  onResume,
  reducedMotion,
}: NotificationViewProps) {
  // Slide-in entrance: render initially shifted off-screen, then transition in
  // on the next frame. Skipped when prefers-reduced-motion is set.
  const [entered, setEntered] = useState(reducedMotion);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (reducedMotion) {
      setEntered(true);
      return;
    }
    timer.current = window.setTimeout(() => setEntered(true), 16);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [reducedMotion]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDismiss(id);
    }
  };

  const transformClass = reducedMotion
    ? ""
    : entered
      ? "translate-x-0 opacity-100"
      : "translate-x-4 opacity-0";
  const transitionClass = reducedMotion ? "" : "transition-all duration-[250ms] ease-out";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ARIA role is set dynamically via ROLE[kind] (status/alert).
    <div
      role={ROLE[kind]}
      aria-live={ARIA_LIVE[kind]}
      aria-atomic="true"
      onMouseEnter={() => onPause(id)}
      onMouseLeave={() => onResume(id)}
      onKeyDown={onKey}
      tabIndex={-1}
      className={`pointer-events-auto w-[360px] border ${BORDER[kind]} bg-black p-3 font-mono text-xs shadow-matrix-glow ${transitionClass} ${transformClass}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`shrink-0 ${kind === "progress" ? "animate-spin inline-block" : ""}`}
        >
          {GLYPH[kind]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="uppercase tracking-widest text-xs break-words">{title}</div>
          {body && <div className="text-matrix-body normal-case mt-1 break-words">{body}</div>}
          {actions && actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: action list is small and stable.
                  key={i}
                  type="button"
                  onClick={() => {
                    a.onClick();
                    onDismiss(id);
                  }}
                  className={`px-2 py-1 border font-mono uppercase tracking-wider text-[10px] transition-shadow focus:outline-none focus:shadow-matrix-focus ${
                    a.variant === "ghost"
                      ? "border-matrix-line text-matrix-body hover:border-matrix-green-muted"
                      : "border-matrix-green text-matrix-green hover:shadow-matrix-glow"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="dismiss notification"
          onClick={() => onDismiss(id)}
          className="shrink-0 px-1 text-matrix-body hover:text-matrix-green focus:outline-none focus:shadow-matrix-focus"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
