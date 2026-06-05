import { useQueryClient } from "@tanstack/react-query";
import type { Platform } from "gui-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveJobsStore } from "@/store/active-jobs";
import { useNotifications } from "@/hooks/useNotifications";
import { driftCheckKey } from "./useDriftCheck";
import { installStateKey } from "./useInstallState";
import { useJobStream } from "./useJobStream";
import { useStartJob } from "./useStartJob";

/**
 * Encapsulates the Re-install flow:
 *   1. POST `agent.install` job for the requested platforms
 *   2. Open a `progress` notification
 *   3. Subscribe to the job's SSE stream
 *   4. On `exit`, mutate the notification to success / error and invalidate
 *      the install-state + drift-check queries so the UI re-fetches
 *
 * Returns `isPending` so the caller (the Re-install button) can disable
 * itself and show a "Re-installing…" label while a job is in flight.
 *
 * Exit-code semantics match the rest of the GUI:
 *   - 0 → success ("Re-installed claude-code, kiro")
 *   - non-zero → error notification with the tail of stderr as the body
 */
export function useReinstall(agent: string): {
  reinstall: (targets: Platform[]) => void;
  isPending: boolean;
} {
  const start = useStartJob();
  const qc = useQueryClient();
  const { notify, update } = useNotifications();
  // Track the currently-watched job so we can subscribe to its stream and
  // mutate the right notification on exit. `null` means no in-flight job.
  const [jobId, setJobId] = useState<string | null>(null);
  const notifIdRef = useRef<string | null>(null);
  const targetsRef = useRef<Platform[]>([]);
  const firedRef = useRef(false);

  const events = useJobStream(jobId ?? undefined);
  const exitEvent = events.find((e) => e.type === "exit");

  // Drive the success/error transition off the SSE exit event. Guarded by
  // firedRef so a re-render after we've already mutated doesn't double-fire.
  useEffect(() => {
    if (!exitEvent || exitEvent.type !== "exit") return;
    if (firedRef.current) return;
    firedRef.current = true;
    const id = notifIdRef.current;
    const targets = targetsRef.current;
    if (id) {
      if (exitEvent.code === 0) {
        update(id, {
          kind: "success",
          title: `Re-installed ${targets.join(", ")}`,
          durationMs: 3000,
        });
      } else {
        // Pull stderr tail for context. SSE chunks aren't line-aligned, so
        // join + trim + take the last few lines.
        const stderrText = events
          .filter((e) => e.type === "stderr")
          .map((e) => (e.type === "stderr" ? e.chunk : ""))
          .join("");
        const lastLines = stderrText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(-3)
          .join(" ");
        update(id, {
          kind: "error",
          title: "Re-install failed",
          body: lastLines || `exited with code ${exitEvent.code}`,
          durationMs: "sticky",
        });
      }
    }
    qc.invalidateQueries({ queryKey: installStateKey(agent) });
    qc.invalidateQueries({ queryKey: driftCheckKey(agent) });
    setJobId(null);
  }, [exitEvent, events, agent, qc, update]);

  const reinstall = useCallback(
    (targets: Platform[]) => {
      if (targets.length === 0) return;
      // Reset transition guard for the new job.
      firedRef.current = false;
      targetsRef.current = targets;
      const id = notify({
        kind: "progress",
        title: `Re-installing ${targets.join(", ")}…`,
        durationMs: "sticky",
      });
      notifIdRef.current = id;
      start.mutate(
        {
          command: "agent.install",
          name: agent,
          platforms: targets,
          withSkills: false,
        },
        {
          onSuccess: (res) => {
            setJobId(res.jobId);
          },
          onError: (err) => {
            const message = err instanceof Error ? err.message : String(err);
            update(id, {
              kind: "error",
              title: "Re-install failed",
              body: message,
              durationMs: "sticky",
            });
            notifIdRef.current = null;
          },
        },
      );
    },
    [agent, notify, start, update],
  );

  // Reflect the underlying mutation pending state AND any tracked job we're
  // still waiting on. The two together cover "between click and POST returning"
  // (start.isPending=true) and "between POST returning and exit event"
  // (jobId !== null, start.isPending=false).
  //
  // We subscribe to the active-jobs store's `commands` slice (rather than
  // `exits[jobId]`) so the component re-renders when the same job is re-pushed
  // — `exits[jobId]` would otherwise stay `undefined` referentially-equal and
  // never trigger a re-render in tests that simulate the SSE exit by mutating
  // a shared stream-state map and then re-pushing.
  const commands = useActiveJobsStore((s) => s.commands);
  const exits = useActiveJobsStore((s) => s.exits);
  const exitsForJob = jobId ? exits[jobId] : undefined;
  // Reference `commands` so its identity change forces a re-render even when
  // exitsForJob stays `undefined`.
  void commands;
  const isPending = start.isPending || (jobId !== null && exitsForJob === undefined && !exitEvent);

  return { reinstall, isPending };
}
