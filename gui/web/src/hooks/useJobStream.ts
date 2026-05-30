import { useEffect, useRef, useState } from "react";
import { jobsApi } from "@/api/jobs";
import type { JobEvent } from "@/lib/job-events";

export function useJobStream(jobId: string | undefined) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const closedRef = useRef(false);
  useEffect(() => {
    // Reset accumulated events whenever the tracked jobId changes so that
    // a prior job's output cannot bleed into a new job's view. Folded into
    // the same effect as the EventSource lifecycle so the reset and the
    // subscription share a single jobId dependency \u2014 biome's
    // useExhaustiveDependencies flagged a separate setEvents-only effect
    // listing [jobId] as a misleading dependency.
    setEvents([]);
    if (!jobId) return;
    closedRef.current = false;
    const es = new EventSource(jobsApi.streamUrl(jobId));
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as JobEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "exit") {
          closedRef.current = true;
          es.close();
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      if (!closedRef.current) es.close();
    };
    return () => es.close();
  }, [jobId]);
  return events;
}
