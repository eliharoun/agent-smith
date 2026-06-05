import { useEffect, useId, useRef } from "react";
import { Button } from "@/ui/Button";

/**
 * 3-button confirm shown when the user flips a previously-non-lazy URL
 * source to lazy AND there are install-time cached artifacts on disk for
 * that source. Lazy URL sources fetch at runtime; the cached files are no
 * longer used. We let the user decide whether to keep them (reversible)
 * or delete them now.
 *
 * Visual style matches `ConfirmModal` — bordered card on dimmed backdrop,
 * matrix-green typography. Wrapper div pinned to dialog role with
 * aria-labelledby for screen readers; Esc fires onCancel.
 */

export interface StaleArtifactsConfirmModalProps {
  onCancel: () => void;
  onSaveKeep: () => void;
  onSaveDelete: () => void;
}

export function StaleArtifactsConfirmModal({
  onCancel,
  onSaveKeep,
  onSaveDelete,
}: StaleArtifactsConfirmModalProps) {
  const titleId = useId();
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="border border-matrix-green bg-black p-6 w-full max-w-md">
        <h2
          id={titleId}
          className="font-mono text-matrix-green uppercase tracking-widest text-sm mb-3"
        >
          // Switch to lazy fetch?
        </h2>
        <div className="text-matrix-body text-sm mb-6">
          This source has cached content from a previous install. Switching to lazy means the
          agent will fetch fresh content at runtime — the cached files are no longer used. You
          can keep them (reversible) or delete them now.
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onSaveDelete}>
            Save and delete cached files
          </Button>
          <Button variant="primary" onClick={onSaveKeep}>
            Save and keep cached files
          </Button>
        </div>
      </div>
    </div>
  );
}
