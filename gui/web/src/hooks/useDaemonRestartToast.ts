import { useEffect, useRef } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useDaemonStatus } from "./useDaemonStatus";

export function useDaemonRestartToast(): void {
  const { data: status } = useDaemonStatus();
  const { notify } = useNotifications();
  const prevPidRef = useRef<number | null>(null);

  useEffect(() => {
    if (!status || status.state !== "running") return;
    const currentPid = status.pid;
    if (prevPidRef.current === null) {
      // First observation — set baseline without firing a toast.
      prevPidRef.current = currentPid;
      return;
    }
    if (currentPid !== prevPidRef.current) {
      prevPidRef.current = currentPid;
      notify({
        kind: "info",
        title: "smith updated",
        body: "Daemon restarted with the new binary.",
        durationMs: 5000,
        dedupKey: "daemon-restart",
      });
    }
  }, [status, notify]);
}
