import type { ReactNode } from "react";
import { Button } from "./Button";

export function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  danger,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-green bg-black p-6 w-full max-w-md">
        <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm mb-3">
          // {title}
        </h2>
        <div className="text-matrix-body text-sm mb-6">{body}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
