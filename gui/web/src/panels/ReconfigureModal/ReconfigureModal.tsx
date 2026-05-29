import type { Platform } from "gui-shared";
import { useEffect, useState } from "react";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { useRefreshManifest } from "@/hooks/useRefreshManifest";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";

/**
 * ReconfigureModal — grant/revoke per-platform refresh-hook consent for an
 * already-installed agent.
 *
 * Per-platform gating: a checkbox is enabled iff the agent is installed on
 * that platform OR consent is already granted there. Rationale:
 * - GRANT requires the agent to be installed on the platform; the CLI rejects
 *   `--grant <plat>` for non-installed platforms with a usage error.
 * - REVOKE on an uninstalled platform is a valid cleanup operation when the
 *   manifest still records consent (e.g. agent was installed → granted →
 *   uninstalled without revoking). The CLI tolerates this; we surface it by
 *   keeping the checkbox enabled when `currentlyGranted[t]` is true.
 *
 * This partially reverts the rationale of commit 5b3d931, which left every
 * checkbox enabled because it conflated grant with consent. The CLI
 * demonstrably enforces install-then-grant.
 */
export function ReconfigureModal({
  agent,
  targets,
  onClose,
}: {
  agent: string;
  targets: Platform[];
  onClose: () => void;
}) {
  const manifest = useRefreshManifest(agent);
  const statuses = useInstalledStatuses();
  const start = useStartJob();

  // Local form state — `desired[p]` true = should be granted; false = should not.
  // Seeded from server state once the manifest query resolves.
  const [desired, setDesired] = useState<Partial<Record<Platform, boolean>> | null>(null);

  useEffect(() => {
    if (!manifest.data) return;
    if (desired !== null) return; // only seed once
    const granted = new Set(manifest.data.platforms);
    const seed: Partial<Record<Platform, boolean>> = {};
    for (const p of targets) seed[p] = granted.has(p);
    setDesired(seed);
  }, [manifest.data, desired, targets]);

  if (!manifest.data || desired === null) {
    return (
      <div
        role="dialog"
        aria-label="Reconfigure agent"
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      >
        <div className="bg-matrix-bg border border-matrix-line p-6 max-w-md w-full">
          <p className="font-mono text-matrix-body">Loading…</p>
        </div>
      </div>
    );
  }

  const currentGranted = new Set(manifest.data.platforms);
  const installed = statuses.data?.[agent]?.installed ?? {};

  function handleSave() {
    const grant: Platform[] = [];
    const revoke: Platform[] = [];
    for (const p of targets) {
      const want = desired![p] ?? false;
      const have = currentGranted.has(p);
      if (want && !have) grant.push(p);
      if (!want && have) revoke.push(p);
    }
    if (grant.length === 0 && revoke.length === 0) {
      onClose();
      return;
    }
    start.mutate(
      { command: "agent.reconfigure", name: agent, grant, revoke },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Reconfigure agent"
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div className="bg-matrix-bg border border-matrix-line p-6 max-w-md w-full">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
          // reconfigure {agent}
        </div>
        <p className="text-matrix-body text-sm mb-4">
          Toggle which platforms should run the refresh hook for this agent.
        </p>
        {targets.length === 0 ? (
          <p className="font-mono text-xs text-matrix-green-muted mb-6">
            // this agent declares no platform targets
          </p>
        ) : (
          <div className="space-y-2 mb-6">
            {targets.map((p) => {
              const isInstalled = installed[p] === true;
              const isGranted = currentGranted.has(p);
              const canToggle = isInstalled || isGranted;
              const checkboxTitle = canToggle
                ? undefined
                : `Install this agent on ${p} to enable refresh-hook consent.`;
              return (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={desired[p] ?? false}
                    disabled={!canToggle}
                    title={checkboxTitle}
                    onChange={(e) => setDesired({ ...desired, [p]: e.target.checked })}
                    aria-label={p}
                  />
                  <span className="font-mono text-matrix-body">{p}</span>
                </label>
              );
            })}
          </div>
        )}
        {start.isError && (
          <div className="font-mono text-[10px] text-matrix-red mb-3">
            // error: {start.error instanceof Error ? start.error.message : String(start.error)}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={start.isPending || targets.length === 0}>
            {start.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
