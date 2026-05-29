import { useStartJob } from "@/hooks/useStartJob";
import { useUpdatePreview } from "@/hooks/useUpdatePreview";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

/**
 * /system/update — dry-run preview of `smith update`. The global
 * <JobStreamModal /> (mounted in App.tsx) automatically surfaces the
 * spawned job's progress, so this panel only needs to start the job
 * and not own any modal state.
 */
export function UpdatePreview() {
  const q = useUpdatePreview();
  const start = useStartJob();

  if (q.isLoading) {
    return (
      <Card>
        <div className="font-mono text-matrix-body">// checking origin…</div>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card>
        <div className="font-mono text-matrix-red">// preview failed</div>
        <pre className="font-mono text-xs whitespace-pre-wrap mt-2 text-matrix-body">
          {String(q.error ?? "unknown error")}
        </pre>
      </Card>
    );
  }

  const { alreadyUpToDate, commitsBehind, rawOutput } = q.data;

  const onRun = () => {
    start.mutate({ command: "update", dryRun: false });
  };

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // smith update
      </div>
      {alreadyUpToDate ? (
        <div className="flex items-center gap-3">
          <Chip tone="green">UP TO DATE</Chip>
          <span className="font-mono text-sm text-matrix-green-muted">
            no commits behind origin/main
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <Chip tone="amber">{commitsBehind} BEHIND</Chip>
            <span className="font-mono text-sm text-matrix-green-muted">
              run `smith update` to pull and reinstall
            </span>
          </div>
          <Button variant="primary" onClick={onRun} disabled={start.isPending}>
            run update
          </Button>
        </>
      )}
      <details className="mt-4">
        <summary className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted cursor-pointer">
          raw cli output
        </summary>
        <pre className="font-mono text-xs whitespace-pre-wrap mt-2 text-matrix-green-muted">
          {rawOutput}
        </pre>
      </details>
    </Card>
  );
}
