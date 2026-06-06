// gui/web/src/hooks/useDetectPlatformCli.ts
import { useCallback, useEffect, useRef } from "react";
import type { PendingOp } from "../../../../src/io/pending-ops";
import { pendingOpsApi } from "@/api/platforms";
import { useNotifications } from "@/hooks/useNotifications";
import { useStartJob } from "@/hooks/useStartJob";
import { useDetectedPlatforms } from "./useDetectedPlatforms";

/**
 * Watches for newly-detected platform CLIs (i.e., CLIs that weren't on PATH
 * last poll but now are). When a new platform appears, fetches any queued
 * pending ops for that platform and fires an info toast offering one-click
 * replay.
 *
 * On first mount, silently sets a baseline — no toast fires unless the set
 * of detected platforms grows compared to the baseline.
 */
export function useDetectPlatformCli(): void {
  const { data } = useDetectedPlatforms();
  const { notify, update } = useNotifications();
  const start = useStartJob();
  const prevRef = useRef<Set<string> | null>(null);

  const handleReplay = useCallback(
    (ops: PendingOp[]) => {
      const count = ops.length;
      const platformList = [...new Set(ops.map((o) => o.platform))].join(", ");
      // Fire ONE aggregate progress toast instead of N individual toasts.
      const aggregateId = notify({
        kind: "progress",
        title: `Replaying ${count} pending install${count === 1 ? "" : "s"}…`,
        body: `Platforms: ${platformList}`,
        durationMs: "sticky",
        dedupKey: "pending-ops-replay",
      });
      // Dispatch one agent.install per queued op — NOT agent.install-all.
      let completed = 0;
      let failed = 0;
      for (const op of ops) {
        start.mutate(
          {
            command: "agent.install",
            name: op.agent,
            platforms: [op.platform] as ("opencode" | "claude-code" | "codex" | "kiro")[],
            withSkills: false,
          },
          {
            onSuccess: () => {
              completed += 1;
              if (completed + failed === count) {
                update(
                  aggregateId,
                  failed === 0
                    ? { kind: "success", title: `Replayed ${count} install${count === 1 ? "" : "s"}`, durationMs: 3000 }
                    : {
                        kind: "error",
                        title: `${failed} of ${count} installs failed`,
                        durationMs: "sticky",
                      },
                );
              }
            },
            onError: () => {
              failed += 1;
              if (completed + failed === count) {
                update(aggregateId, {
                  kind: "error",
                  title: `${failed} of ${count} installs failed`,
                  durationMs: "sticky",
                });
              }
            },
          },
        );
      }
    },
    [start, notify, update],
  );

  useEffect(() => {
    if (!data) return;
    const detected = data.detected;

    // First observation — set baseline silently without firing a toast.
    if (prevRef.current === null) {
      prevRef.current = new Set(detected);
      return;
    }

    const newlyAvailable = detected.filter((p) => !prevRef.current!.has(p));
    prevRef.current = new Set(detected);

    if (newlyAvailable.length === 0) return;

    // Fetch pending ops and filter to those for newly-available platforms.
    void pendingOpsApi.list().then((result) => {
      const relevantOps = result.ops.filter((op) => newlyAvailable.includes(op.platform));
      if (relevantOps.length === 0) return;

      const count = relevantOps.length;
      const platformList = [...new Set(relevantOps.map((o) => o.platform))].join(", ");
      notify({
        kind: "info",
        title: "New platform detected",
        body: `${count} pending install${count === 1 ? "" : "s"} queued for ${platformList}`,
        durationMs: "sticky",
        dedupKey: `pending-ops-replay:${newlyAvailable.slice().sort().join(",")}`,
        actions: [
          {
            label: `Replay ${count} install${count === 1 ? "" : "s"}`,
            onClick: () => handleReplay(relevantOps),
            variant: "primary",
          },
        ],
      });
    });
  }, [data, handleReplay, notify]);
}
