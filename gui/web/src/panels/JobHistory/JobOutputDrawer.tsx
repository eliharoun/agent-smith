import { useJobOutput } from "@/hooks/useJobHistory";

/**
 * Slide-over panel showing the captured stdout/stderr of a finished job.
 * The server returns plain text from `/api/history/:id/output`; a 404 (or
 * the null result) means the 7-day retention window has lapsed.
 */
export function JobOutputDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const q = useJobOutput(jobId);
  return (
    <div className="fixed inset-y-0 right-0 w-2/3 max-w-4xl bg-black border-l border-matrix-line z-40 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-matrix-line">
        <div className="font-mono text-sm text-matrix-green-muted">// output: {jobId}</div>
        <button
          type="button"
          className="font-mono text-matrix-red text-sm hover:text-matrix-red/70"
          onClick={onClose}
        >
          [close]
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {q.isLoading && (
          <div className="font-mono text-xs text-matrix-green-muted">// loading…</div>
        )}
        {q.error && (
          <div className="font-mono text-xs text-matrix-amber">// output expired or missing</div>
        )}
        {q.data === null && (
          <div className="font-mono text-xs text-matrix-amber">
            // output expired (retention window lapsed)
          </div>
        )}
        {q.data && (
          <pre className="font-mono text-xs whitespace-pre-wrap text-matrix-body">{q.data}</pre>
        )}
      </div>
    </div>
  );
}
