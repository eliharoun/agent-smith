import { useState } from "react";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

function stateChip(state: string): { label: string; tone: "green" | "amber" | "red" | "neutral" } {
  switch (state) {
    case "running":
      return { label: "RUNNING", tone: "green" };
    case "stuck":
      return { label: "STUCK", tone: "amber" };
    case "stale-pid":
      return { label: "STALE PID", tone: "amber" };
    case "not-running":
      return { label: "STOPPED", tone: "neutral" };
    default:
      return { label: state.toUpperCase(), tone: "red" };
  }
}

/**
 * /system/daemon — controls for starting, stopping, and restarting the
 * smith background daemon. Reads state from /api/daemon/status (polled
 * every 2s via useDaemonStatus) and issues daemon.start/daemon.stop
 * JobRequests on click.
 */
export function DaemonControl() {
  const q = useDaemonStatus();
  const start = useStartJob();
  const [restarting, setRestarting] = useState(false);

  if (q.isLoading)
    return (
      <Card>
        <div className="font-mono text-matrix-body">// querying daemon…</div>
      </Card>
    );
  if (q.isError || !q.data)
    return (
      <Card>
        <div className="font-mono text-matrix-body">
          // daemon status unreachable — is the GUI server up?
        </div>
      </Card>
    );

  const status = q.data;
  const chip = stateChip(status.state);
  const pid = "pid" in status ? status.pid : null;
  const ageMs = "heartbeatAgeMs" in status ? status.heartbeatAgeMs : null;

  const onStart = () => start.mutate({ command: "daemon.start" });
  const onStop = () => start.mutate({ command: "daemon.stop" });
  const onRestart = async () => {
    setRestarting(true);
    try {
      await start.mutateAsync({ command: "daemon.stop" });
      // wait for status to flip to not-running (max ~3s)
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const fresh = await q.refetch();
        if (fresh.data?.state === "not-running") break;
      }
      await start.mutateAsync({ command: "daemon.start" });
    } finally {
      setRestarting(false);
      q.refetch();
    }
  };

  const canStart = status.state === "not-running" || status.state === "stale-pid";
  const canStop =
    status.state === "running" || status.state === "stuck" || status.state === "stale-pid";

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // daemon control
      </div>
      <div className="flex items-center gap-3 mb-3 font-mono text-sm">
        <Chip tone={chip.tone}>{chip.label}</Chip>
        {pid !== null && <span className="text-matrix-green-muted">pid {pid}</span>}
        {ageMs !== null && (
          <span className="text-matrix-green-muted">
            heartbeat {ageMs < 1000 ? `${ageMs}ms` : `${Math.round(ageMs / 1000)}s`} ago
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={onStart} disabled={!canStart || start.isPending}>
          start
        </Button>
        <Button onClick={onStop} disabled={!canStop || start.isPending}>
          stop
        </Button>
        <Button onClick={onRestart} disabled={!canStop || start.isPending || restarting}>
          {restarting ? "restarting…" : "restart"}
        </Button>
      </div>
    </Card>
  );
}
