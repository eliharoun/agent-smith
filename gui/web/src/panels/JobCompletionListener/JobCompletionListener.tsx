import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useJobStream } from "@/hooks/useJobStream";
import { useActiveJobsStore } from "@/store/active-jobs";

/**
 * Watches a single in-flight job's SSE stream. When the job emits an `exit`
 * event:
 *   - records exit info in the active-jobs store (via markExit), keeping the
 *     job in `active` so JobStreamModal can show its final output until the
 *     user dismisses it.
 *   - invalidates React Query caches matching the job's command family so
 *     dependent UI refetches against the new on-disk state:
 *       - `agent.*`            → ['agents'], ['onboarding']
 *       - `agent.register`,
 *         `agent.unregister`,
 *         `agent.catalog-rename` (also covered by agent.*) →
 *           additionally invalidate ['catalogs'] since these mutate the
 *           agent-registry catalog set.
 *       - `skill.*`            → ['skills'], ['installed-skills'],
 *                                ['skill-catalogs'], ['catalogs']
 *       - `knowledge.*`        → ['knowledge'] (broad — we don't have the
 *                                agent name without parsing the request body;
 *                                a broad invalidate is cheap and correct) and
 *                                ['agents'] (knowledge counts surface in
 *                                agent metadata).
 *
 * Invalidation is intentionally NOT gated on exit code: a failed
 * install/destroy/uninstall can still mutate disk state, and the affected
 * queries are cheap to refetch.
 *
 * Dismissal (drop) is the user's job — see JobStreamModal's "Close" button.
 */
function JobWatcher({ id, command }: { id: string; command: string }) {
  const events = useJobStream(id);
  const qc = useQueryClient();
  const markExit = useActiveJobsStore((s) => s.markExit);
  const exitEvent = events.find((e) => e.type === "exit");
  const firedRef = useRef(false);
  useEffect(() => {
    if (!exitEvent || firedRef.current) return;
    firedRef.current = true;
    if (command.startsWith("agent.")) {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    }
    if (
      command === "agent.register" ||
      command === "agent.unregister" ||
      command === "agent.catalog-rename"
    ) {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
    }
    if (command.startsWith("skill.")) {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["installed-skills"] });
      qc.invalidateQueries({ queryKey: ["skill-catalogs"] });
      qc.invalidateQueries({ queryKey: ["catalogs"] });
    }
    if (command.startsWith("knowledge.")) {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    }
    if (exitEvent.type === "exit") {
      markExit(id, { code: exitEvent.code, durationMs: exitEvent.durationMs });
    }
  }, [exitEvent, command, id, markExit, qc]);
  return null;
}

/**
 * Top-level listener that subscribes to every in-flight job's stream and,
 * on completion, marks the job as exited and invalidates dependent queries.
 * Mounted once in App.tsx so behavior is independent of which modal is open.
 */
export function JobCompletionListener() {
  const active = useActiveJobsStore((s) => s.active);
  const commands = useActiveJobsStore((s) => s.commands);
  return (
    <>
      {active.map((id) => {
        const command = commands[id];
        if (!command) return null;
        return <JobWatcher key={id} id={id} command={command} />;
      })}
    </>
  );
}
