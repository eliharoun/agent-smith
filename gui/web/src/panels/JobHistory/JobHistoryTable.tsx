import { useJobHistory } from "@/hooks/useJobHistory";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * Last 50 finished jobs from `/api/history`. Clicking a row with
 * `outputAvailable: true` calls `onSelect(id)` so the parent can open
 * `JobOutputDrawer`. Rows whose 7-day output retention has lapsed show
 * "expired" and are not clickable.
 */
export function JobHistoryTable({ onSelect }: { onSelect: (id: string) => void }) {
  const q = useJobHistory({ limit: 50, offset: 0 });

  if (q.isLoading) {
    return (
      <Card>
        <div className="font-mono text-xs text-matrix-green-muted">// loading history…</div>
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card>
        <div className="font-mono text-xs text-matrix-red">
          // failed to load history: {String(q.error)}
        </div>
      </Card>
    );
  }
  if (!q.data || q.data.length === 0) {
    return (
      <Card>
        <div className="font-mono text-xs text-matrix-green-muted">// no jobs recorded yet</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // job history ({q.data.length})
      </div>
      <table className="w-full font-mono text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-matrix-green-muted">
            <th className="text-left py-1">finished</th>
            <th className="text-left">command</th>
            <th className="text-left">duration</th>
            <th className="text-left">exit</th>
            <th className="text-left">output</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((row) => {
            const clickable = row.outputAvailable;
            return (
              <tr
                key={row.id}
                className={`border-t border-matrix-line ${
                  clickable ? "cursor-pointer hover:bg-matrix-green/5" : "opacity-60"
                }`}
                onClick={() => clickable && onSelect(row.id)}
              >
                <td className="py-1">{new Date(row.endedAt).toLocaleTimeString()}</td>
                <td className="text-matrix-green-muted truncate max-w-xs" title={row.argvPreview}>
                  {row.argvPreview}
                </td>
                <td>{fmtDuration(row.durationMs)}</td>
                <td>
                  <Chip tone={row.exitCode === 0 ? (row.degraded ? "amber" : "green") : "red"}>
                    {row.exitCode}
                  </Chip>
                </td>
                <td className="text-xs text-matrix-green-muted">
                  {clickable ? "view →" : "expired"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
