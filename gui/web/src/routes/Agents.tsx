import { useState } from "react";
import { Link } from "react-router-dom";
import { AgentList } from "@/panels/AgentList";
import { InstallFromUrlModal } from "@/panels/InstallFromUrlModal";
import {
  InstallJobWatcher,
  useInstallCompletionWatcher,
} from "@/hooks/useInstallCompletionWatcher";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

// InstallFromUrlButton (C4.8.2) — pairs the ghost-style trigger with the
// v0.26.0 pulse dot. The dot is decorative (aria-hidden); it telegraphs the
// new external-install entry point until it stops being new.
function InstallFromUrlButton({ onClick }: { onClick: () => void }) {
  return (
    <span className="relative inline-block">
      <span
        data-pulse-dot
        aria-hidden
        className="absolute -top-0.5 -left-0.5 w-[6px] h-[6px] bg-matrix-green shadow-matrix-glow animate-pulse"
      />
      <Button variant="ghost" onClick={onClick}>
        Install from URL
      </Button>
    </span>
  );
}

export function AgentsList() {
  const [installOpen, setInstallOpen] = useState(false);
  const { installJobIds, maybeFire } = useInstallCompletionWatcher();

  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Agents"
          subtitle="construct registry"
          actions={
            <>
              <Link to="/agents/install-matrix">
                <Button variant="ghost">Install matrix</Button>
              </Link>
              <InstallFromUrlButton onClick={() => setInstallOpen(true)} />
              <Link to="/agents/new">
                <Button>+ New agent</Button>
              </Link>
            </>
          }
        />
      }
    >
      <AgentList />
      <InstallFromUrlModal kind="agent" open={installOpen} onClose={() => setInstallOpen(false)} />
      {/* One watcher per active agent.install job — fires sync-hint toast when
          the job exits 0 and its stdout contained a dir-install envelope. */}
      {installJobIds.map((id) => (
        <InstallJobWatcher key={id} jobId={id} maybeFire={maybeFire} />
      ))}
    </ScreenShell>
  );
}
