import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./Button";
import { FormField } from "./FormField";

export function TypedTokenModal({
  title,
  body,
  expectedToken,
  confirmLabel = "Destroy",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  expectedToken: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState("");
  const ok = val === expectedToken;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-red bg-black p-6 w-full max-w-md">
        <h2 className="font-mono text-matrix-red uppercase tracking-widest text-sm mb-3">
          // {title}
        </h2>
        <div className="text-matrix-body text-sm mb-4">{body}</div>
        <FormField
          label={`type "${expectedToken}" to confirm`}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ok} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
