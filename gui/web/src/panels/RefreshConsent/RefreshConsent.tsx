import { useState } from "react";
import { Button } from "@/ui/Button";
import { Toggle } from "@/ui/Toggle";

type Platform = "opencode" | "claude-code" | "codex" | "kiro";
type Consent = "yes" | "no";

export function RefreshConsent({
  agent,
  platforms,
  onCancel,
  onConfirm,
}: {
  agent: string;
  platforms: Platform[];
  onCancel: () => void;
  onConfirm: (consent: Record<Platform, Consent>) => void;
}) {
  const init = Object.fromEntries(platforms.map((p) => [p, "no" as Consent])) as Record<
    Platform,
    Consent
  >;
  const [state, setState] = useState<Record<Platform, Consent>>(init);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-green bg-black p-6 w-full max-w-md">
        <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm mb-3">
          // install {agent}
        </h2>
        <p className="text-matrix-body text-sm mb-4">
          Enable knowledge-refresh hooks on these platforms? You can change this later via Doctor.
        </p>
        <ul className="space-y-2 mb-4">
          {platforms.map((p) => (
            <li key={p} className="flex items-center justify-between">
              <span className="font-mono text-sm text-matrix-body">{p}</span>
              <Toggle
                checked={state[p] === "yes"}
                onChange={(v) => setState((s) => ({ ...s, [p]: v ? "yes" : "no" }))}
                label={state[p] === "yes" ? "yes" : "no"}
              />
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(state)}>Install</Button>
        </div>
      </div>
    </div>
  );
}
