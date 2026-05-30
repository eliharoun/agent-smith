import { useEffect, useMemo, useRef, useState } from "react";
import { jobsApi } from "@/api/jobs";
import { useJob } from "@/hooks/useJob";
import { useJobStream } from "@/hooks/useJobStream";
import { redactUrlCredentials } from "@/lib/redact-url-credentials";
import { useActiveJobsStore } from "@/store/active-jobs";
import { selectModalJob } from "@/store/select-modal-job";
import { Button } from "@/ui/Button";
import { TerminalLog, type TerminalLogLine } from "@/ui/TerminalLog";

function PromptInput({ jobId, promptId }: { jobId: string; promptId: string }) {
  const [val, setVal] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !val.trim() || pending;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          aria-label={`prompt response ${promptId}`}
          className="flex-1 bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          disabled={pending}
        />
        <Button
          disabled={disabled}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await jobsApi.respond(jobId, val);
              setVal("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "send failed");
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error && <p className="font-mono text-[10px] text-matrix-amber">// error: {error}</p>}
    </div>
  );
}

export function JobStreamModal() {
  const active = useActiveJobsStore((s) => s.active);
  const exits = useActiveJobsStore((s) => s.exits);
  const drop = useActiveJobsStore((s) => s.drop);
  const current = useMemo(() => selectModalJob(active, exits), [active, exits]);
  const [hidden, setHidden] = useState(false);
  const [logKey, setLogKey] = useState(0);
  // Reset hidden whenever the selected job id changes so a minimized job
  // doesn't suppress a different job that takes its place. Also bump logKey
  // so the TerminalLog remounts cleanly and any cached DOM is discarded.
  const prevCurrentRef = useRef(current);
  useEffect(() => {
    if (prevCurrentRef.current !== current) {
      prevCurrentRef.current = current;
      setHidden(false);
      setLogKey((k) => k + 1);
    }
  }, [current]);
  const job = useJob(current);
  const events = useJobStream(current);
  if (!current || hidden) return null;

  const exitInfo = exits[current];
  const done = exitInfo !== undefined;

  const lines: TerminalLogLine[] = events.flatMap((e): TerminalLogLine[] =>
    e.type === "stdout"
      ? [{ kind: "stdout", text: redactUrlCredentials(e.chunk) }]
      : e.type === "stderr"
        ? [{ kind: "stderr", text: redactUrlCredentials(e.chunk) }]
        : e.type === "exit"
          ? [{ kind: "system", text: `[exit ${e.code} · ${e.durationMs}ms]` }]
          : [],
  );
  const reversed = [...events].reverse();
  const promptEvent = reversed.find((e) => e.type === "prompt");
  const lastExit = reversed.find((e) => e.type === "exit");
  const showPrompt = promptEvent && !lastExit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="border border-matrix-green bg-black p-4 w-full max-w-3xl">
        <div className="flex items-center justify-between mb-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
            // {job.data?.preview ?? "running…"}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setHidden(true)}>
              Minimize
            </Button>
            {done && (
              <Button
                onClick={() => {
                  drop(current);
                  setHidden(false);
                }}
              >
                Close
              </Button>
            )}
          </div>
        </div>
        {done && exitInfo && (
          <p
            className={`mb-2 font-mono text-xs ${
              exitInfo.code === 0 ? "text-matrix-green" : "text-matrix-amber"
            }`}
          >
            {exitInfo.code === 0
              ? `// completed (exit 0${exitInfo.durationMs !== undefined ? ` · ${exitInfo.durationMs}ms` : ""})`
              : `// failed with exit code ${exitInfo.code}${exitInfo.durationMs !== undefined ? ` · ${exitInfo.durationMs}ms` : ""}`}
          </p>
        )}
        {events.length === 0 && !done ? (
          <div className="font-mono text-sm text-matrix-green-muted py-2">
            // starting {job.data?.preview ?? "job"}…
          </div>
        ) : (
          <TerminalLog key={logKey} lines={lines} height={320} />
        )}
        {showPrompt && (
          <div className="mt-3 border border-matrix-amber p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-amber mb-2">
              // prompt
            </div>
            <p className="text-matrix-body text-sm mb-2">{promptEvent.question}</p>
            <PromptInput jobId={current} promptId={promptEvent.id} />
          </div>
        )}
      </div>
    </div>
  );
}
