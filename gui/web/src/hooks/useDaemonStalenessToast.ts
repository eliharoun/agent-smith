// gui/web/src/hooks/useDaemonStalenessToast.ts
import { useEffect, useRef } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useStartJob } from "@/hooks/useStartJob";
import { useDaemonStatus } from "./useDaemonStatus";

const DEDUP_KEY = "daemon-stale";

function isStale(status: ReturnType<typeof useDaemonStatus>["data"]): boolean {
  if (!status) return false;
  if (status.state === "stuck") return true;
  if (status.state === "stale-pid") return true;
  if (status.state === "running" && status.heartbeatAgeMs !== null && status.heartbeatAgeMs > 15_000) return true;
  return false;
}

export function useDaemonStalenessToast(): void {
  const { data: status } = useDaemonStatus();
  const { notify, update } = useNotifications();
  const start = useStartJob();
  const notifIdRef = useRef<string | null>(null);
  const wasStaleRef = useRef(false);

  useEffect(() => {
    const stale = isStale(status);
    if (stale && !wasStaleRef.current) {
      wasStaleRef.current = true;
      const id = notify({
        kind: "error",
        title: "Daemon appears stuck",
        body: "Heartbeat stopped — the background sync process may have crashed.",
        durationMs: "sticky",
        dedupKey: DEDUP_KEY,
        actions: [
          {
            label: "Restart daemon",
            onClick: () => {
              start.mutate({ command: "daemon.start" });
            },
            variant: "primary",
          },
        ],
      });
      notifIdRef.current = id;
    } else if (!stale && wasStaleRef.current) {
      wasStaleRef.current = false;
      const id = notifIdRef.current;
      if (id) {
        update(id, {
          kind: "success",
          title: "Daemon recovered",
          durationMs: 3000,
        });
        notifIdRef.current = null;
      }
    }
  }, [status, notify, update, start]);
}
