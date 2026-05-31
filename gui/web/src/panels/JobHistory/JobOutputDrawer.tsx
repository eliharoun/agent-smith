import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useJobOutput } from "@/hooks/useJobHistory";

/**
 * Slide-over showing a finished job's captured stdout/stderr. Rendered via a
 * portal to document.body so the ScreenShell stacking context (relative z-10)
 * and the sticky TopBar (z-30) can't occlude its close control. Dismissable
 * via [close], Escape, or backdrop click — consistent with the app's modals.
 */
export function JobOutputDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const q = useJobOutput(jobId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    // Lighter backdrop than the app's centered modals (bg-black/80): this is a
    // right-side slide-over, so the history list stays partly visible behind it.
    // Backdrop click (target === currentTarget) closes; Escape handled above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape (window listener) + the [close] button provide keyboard dismissal
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="h-full w-2/3 max-w-4xl bg-black border-l border-matrix-line flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-matrix-line">
          <div className="font-mono text-sm text-matrix-green-muted">// output: {jobId}</div>
          <button
            type="button"
            className="font-mono text-matrix-red text-sm hover:text-matrix-red/70"
            onClick={onClose}
          >
            [close]
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {q.isLoading && (
            <div className="font-mono text-xs text-matrix-green-muted">// loading…</div>
          )}
          {q.error && (
            <div className="font-mono text-xs text-matrix-amber">// output expired or missing</div>
          )}
          {q.data === null && (
            <div className="font-mono text-xs text-matrix-amber">
              // output expired (retention window lapsed)
            </div>
          )}
          {q.data && (
            <pre className="font-mono text-xs whitespace-pre-wrap text-matrix-body">{q.data}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
