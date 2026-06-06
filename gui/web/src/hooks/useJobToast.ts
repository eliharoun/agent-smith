import type { JobRequest } from "gui-shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveJobsStore } from "@/store/active-jobs";
import { useNotifications } from "@/hooks/useNotifications";
import { useJobStream } from "./useJobStream";
import { useStartJob } from "./useStartJob";

export interface UseJobToastOptions {
  command: string;
  /**
   * Label functions called once at dispatch time. All three are evaluated
   * immediately when dispatch() is called and the resolved strings are stored
   * in a ref. This ensures "Installing X…" and "Installed X" reference the
   * same name even if the user modifies a form field while the job runs.
   * Convention:
   *   progress  →  () => "<Verb-ing> <name>…"  e.g. () => `Installing ${name}…`
   *   success   →  () => "<Verb-ed> <name>"    e.g. () => `Installed ${name}`
   *   error     →  () => "<Verb> failed"       e.g. () => "Install failed"
   */
  label: {
    progress: () => string;
    success: () => string;
    error: () => string;
  };
  dedupKey?: string;
  onSuccess?: (jobId: string) => void;
  onError?: (code: number, stderrTail: string) => void;
}

export interface UseJobToastResult {
  dispatch: (req: JobRequest) => void;
  isPending: boolean;
}

export function useJobToast(opts: UseJobToastOptions): UseJobToastResult {
  const start = useStartJob();
  const { notify, update } = useNotifications();
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<string | null>(null);
  const notifIdRef = useRef<string | null>(null);
  const firedRef = useRef(false);
  const lastReqRef = useRef<JobRequest | null>(null);
  // Resolved label strings captured at dispatch time.
  // Declared BEFORE the useEffect that reads it to satisfy ESLint react-hooks
  // rules and maintain proper runtime declaration ordering.
  const capturedLabelsRef = useRef<{ progress: string; success: string; error: string } | null>(null);
  const effectiveKey = opts.dedupKey ?? `job-toast:${opts.command}`;

  const events = useJobStream(jobId ?? undefined);
  const exitEvent = events.find((e) => e.type === "exit");

  // Drive the success/error transition off the SSE exit event. Guarded by
  // firedRef so a re-render after we've already mutated doesn't double-fire.
  useEffect(() => {
    if (!exitEvent || exitEvent.type !== "exit") return;
    if (firedRef.current) return;
    firedRef.current = true;
    const id = notifIdRef.current;
    if (id) {
      const labels = capturedLabelsRef.current ?? {
        progress: opts.label.progress(),
        success: opts.label.success(),
        error: opts.label.error(),
      };
      if (exitEvent.code === 0) {
        update(id, {
          kind: "success",
          title: labels.success,
          durationMs: 3000,
        });
      } else {
        // Pull stderr tail for context. SSE chunks aren't line-aligned, so
        // join + trim + take the last few lines.
        const stderrText = events
          .filter((e) => e.type === "stderr")
          .map((e) => (e.type === "stderr" ? e.chunk : ""))
          .join("");
        const stderrTail = stderrText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(-3)
          .join(" ");
        const currentJobId = jobId;
        update(id, {
          kind: "error",
          title: labels.error,
          body: stderrTail || `exited with code ${exitEvent.code}`,
          durationMs: "sticky",
          actions: [
            {
              label: "Retry",
              onClick: () => {
                if (lastReqRef.current) dispatch(lastReqRef.current);
              },
              variant: "primary",
            },
            {
              label: "View logs",
              onClick: () => navigate("/system/history"),
            },
          ],
        });
        opts.onError?.(exitEvent.code, stderrTail);
        void currentJobId;
      }
    }
    if (exitEvent.code === 0 && jobId) {
      opts.onSuccess?.(jobId);
    }
    setJobId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitEvent, events, jobId, navigate, update]);

  const dispatch = useCallback(
    (req: JobRequest) => {
      firedRef.current = false;
      lastReqRef.current = req;
      // Resolve all three label functions once at dispatch time and cache them.
      // This way success/error transitions always reference the same name as the
      // progress toast, even if the user edits a form field while the job runs.
      capturedLabelsRef.current = {
        progress: opts.label.progress(),
        success: opts.label.success(),
        error: opts.label.error(),
      };
      const id = notify({
        kind: "progress",
        title: capturedLabelsRef.current.progress,
        durationMs: "sticky",
        dedupKey: effectiveKey,
      });
      notifIdRef.current = id;
      start.mutate(req, {
        onSuccess: (res) => {
          setJobId(res.jobId);
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          update(id, {
            kind: "error",
            title: capturedLabelsRef.current?.error ?? opts.label.error(),
            body: message,
            durationMs: "sticky",
          });
          notifIdRef.current = null;
        },
      });
    },
    [effectiveKey, notify, opts.label, start, update],
  );

  const commands = useActiveJobsStore((s) => s.commands);
  const exits = useActiveJobsStore((s) => s.exits);
  const exitsForJob = jobId ? exits[jobId] : undefined;
  // Reference `commands` so its identity change forces a re-render even when
  // exitsForJob stays `undefined`.
  void commands;
  const isPending = start.isPending || (jobId !== null && exitsForJob === undefined && !exitEvent);

  return { dispatch, isPending };
}
