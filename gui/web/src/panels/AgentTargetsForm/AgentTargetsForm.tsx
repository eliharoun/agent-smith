import type { AgentDetail, Platform } from "gui-shared";
import { useMemo, useState } from "react";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";
import { ReconfigureModal } from "@/panels/ReconfigureModal";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

export function AgentTargetsForm({ agent }: { agent: AgentDetail }) {
  const [modalOpen, setModalOpen] = useState(false);
  const statuses = useInstalledStatuses();

  // Gate the Reconfigure button on whether the agent is installed on at least
  // one declared target. The CLI rejects `--grant` for non-installed
  // platforms with a usage error, so an "all uninstalled" reconfigure cannot
  // succeed in any useful form. Stale-grant cleanup (manifest says granted
  // for an uninstalled platform) is handled at the per-checkbox level inside
  // the modal — but is reachable only when at least one platform is installed
  // (i.e. the modal can open). For the rare all-uninstalled-with-stale-grant
  // case, users fall back to the CLI. See plan F-T5-X.
  const installed = statuses.data?.[agent.name]?.installed ?? {};
  const anyInstalled = useMemo(
    () => agent.targets.some((t: Platform) => installed[t] === true),
    [agent.targets, installed],
  );

  const buttonDisabled = !statuses.isSuccess || !anyInstalled;

  return (
    <>
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // targets · model
        </div>
        <div className="mb-3 flex gap-2">
          {agent.targets.map((t) => (
            <Chip key={t} tone="green">
              {t}
            </Chip>
          ))}
        </div>
        <div className="font-mono text-sm text-matrix-body mb-3">model: {agent.model ?? "—"}</div>
        <Button onClick={() => setModalOpen(true)} disabled={buttonDisabled}>
          Reconfigure
        </Button>
        {!statuses.isSuccess && (
          <p className="mt-2 font-mono text-xs text-matrix-green-muted">Loading install status…</p>
        )}
        {statuses.isSuccess && !anyInstalled && (
          <p className="mt-2 font-mono text-xs text-matrix-green-muted">
            Install on at least one platform to manage refresh consent.
          </p>
        )}
      </Card>
      {modalOpen && (
        <ReconfigureModal
          agent={agent.name}
          targets={agent.targets}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
