import { useEffect, useRef, useState } from "react";
import { useInstalledStatus } from "@/hooks/useAgents";
import { Button } from "@/ui/Button";

/**
 * AgentDestroyModal — typed-token destroy confirmation that also explains
 * the orphan-file rationale for `--force`.
 *
 * Replaces the thinner `TypedTokenModal`-based flow with one that:
 *   1. Fetches `/api/agents/:name/installed-status` so the user sees which
 *      platforms currently hold rendered files (these will be uninstalled
 *      first by the chained `--force` destroy).
 *   2. Surfaces the orphan-file rationale up-front: destroying the source
 *      while editor configs still reference it would leave dangling agent
 *      definitions. The CLI guards against this (see
 *      `src/cli/commands/destroy-agent.ts` and the user-facing message
 *      "dangling agent definitions"); the modal mirrors that wording so
 *      the GUI never silently does something the CLI would reject.
 *   3. Dispatches `agent.destroy` with `force: true`, so the server's
 *      argv builder appends `--force` and the CLI runs uninstall + destroy
 *      under the single `agent:<name>` lock in the correct order.
 *
 * `onDispatch` is optional to keep this component testable in isolation;
 * the production caller (`AgentDestroyButton`) passes a real
 * `useStartJob().mutateAsync` callback.
 */
export interface AgentDestroyModalProps {
  agentName: string;
  open: boolean;
  onClose: () => void;
  onDispatch?: (job: {
    command: "agent.destroy";
    name: string;
    confirmName: string;
    force: true;
  }) => void;
}

export function AgentDestroyModal({
  agentName,
  open,
  onClose,
  onDispatch,
}: AgentDestroyModalProps) {
  const [token, setToken] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Reset typed token whenever the modal transitions to closed so a
  // Cancel→reopen cycle starts from an empty input.
  useEffect(() => {
    if (!open) setToken("");
  }, [open]);
  // Focus the confirmation input when the modal opens. Replaces the
  // `autoFocus` attribute (biome a11y/noAutofocus) with a programmatic
  // focus that only runs in response to the user's explicit "Destroy"
  // click that opened this modal.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const matches = token === agentName;
  const status = useInstalledStatus(open ? agentName : "");
  const installed = Object.entries(status.data?.installed ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Destroy agent ${agentName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <div className="border border-matrix-red bg-black p-6 w-full max-w-lg">
        <h2 className="font-mono text-matrix-red uppercase tracking-widest text-sm mb-3">
          // destroy agent "{agentName}"
        </h2>
        <p className="text-matrix-body text-xs mb-3">
          Permanently removes the agent's source files at{" "}
          <code className="text-matrix-green">~/.config/agent-smith/agents/{agentName}/</code>.
          There is no undo.
        </p>
        {installed.length > 0 && (
          <>
            <p className="text-matrix-body text-xs mt-3">Currently installed in:</p>
            <ul className="ml-3 mt-1 text-xs font-mono text-matrix-green">
              {installed.map((t) => (
                <li key={t}>
                  [✓] {t}{" "}
                  <span className="text-matrix-green-muted">— will be uninstalled first</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3 border border-matrix-line p-2 text-[11px] text-matrix-green-muted">
          <strong className="text-matrix-green">ⓘ Why uninstall is required</strong>
          <p className="mt-1">
            Destroying the source while {installed[0] ?? "an editor"} still has rendered files would
            leave dangling agent definitions in your editor configs (orphan files pointing at
            nothing). <code className="text-matrix-green">--force</code> chains both steps in the
            correct order under the <code>agent:{agentName}</code> lock.
          </p>
        </div>
        <label className="block mt-3 text-xs text-matrix-body">
          Type "<span className="text-matrix-green font-mono">{agentName}</span>" to confirm:
          <input
            ref={inputRef}
            className="block w-full mt-1 font-mono text-sm bg-black border border-matrix-line p-1 text-matrix-green"
            placeholder={agentName}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            onClick={() =>
              onDispatch?.({
                command: "agent.destroy",
                name: agentName,
                confirmName: agentName,
                force: true,
              })
            }
          >
            Destroy
          </Button>
        </div>
      </div>
    </div>
  );
}
