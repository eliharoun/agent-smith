import { Link } from "react-router-dom";
import { useRefreshHistory } from "@/hooks/useRefreshHistory";
import { useStartJob } from "@/hooks/useStartJob";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

interface Props {
  agent: string;
}

/**
 * Per-agent refresh provenance: shows the on-disk refresh-cache entry for
 * every source (sourceId, last_refreshed_at, last_attempt_at, last_error,
 * etag/last_modified when present). Used at /knowledge/:agent/refresh-history.
 *
 * Sources without a cache entry are simply absent here (refresh has never
 * run). For a complete source list, link out to the sources editor.
 *
 * Per-row "refresh" dispatches knowledge.fetch with `source` so users can
 * retry just the failing entries. JobCompletionListener invalidates
 * ['knowledge', agent] on knowledge.* exit (covers this hook).
 */
export function RefreshHistory({ agent }: Props) {
  const q = useRefreshHistory(agent);
  const start = useStartJob();

  if (q.isLoading) {
    return (
      <Card>
        <Header agent={agent} />
        <div className="font-mono text-sm text-matrix-body">// loading refresh history…</div>
      </Card>
    );
  }
  if (q.isError) {
    return (
      <Card>
        <Header agent={agent} />
        <div className="font-mono text-sm text-matrix-red">
          // failed to load — {(q.error as Error).message}
        </div>
        <Button variant="ghost" onClick={() => q.refetch()}>
          retry
        </Button>
      </Card>
    );
  }

  const data = q.data!;
  const entries = [...data.entries].sort((a, b) => {
    // Most-recently-attempted first; entries without last_attempt_at sink.
    const ta = a.last_attempt_at ? Date.parse(a.last_attempt_at) : 0;
    const tb = b.last_attempt_at ? Date.parse(b.last_attempt_at) : 0;
    return tb - ta;
  });

  return (
    <Card>
      <Header agent={agent} />
      {entries.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body py-4">
          // no refresh attempts recorded yet — kick off a refresh from the{" "}
          <Link to={`/agents/${agent}?tab=knowledge`} className="text-matrix-green underline">
            sources editor
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y divide-matrix-line">
          {entries.map((e) => (
            <li key={e.sourceId} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-sm text-matrix-green truncate">{e.sourceId}</div>
                <div className="font-mono text-[11px] text-matrix-green-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span title={e.last_refreshed_at ?? ""}>
                    refreshed: {relativeTime(e.last_refreshed_at)}
                  </span>
                  <span title={e.last_attempt_at ?? ""}>
                    attempted: {relativeTime(e.last_attempt_at)}
                  </span>
                  {e.etag && <span>etag: {e.etag.slice(0, 8)}…</span>}
                  {e.last_modified && (
                    <span title={e.last_modified}>modified: {relativeTime(e.last_modified)}</span>
                  )}
                </div>
                {e.last_error && (
                  <div className="font-mono text-[11px] text-matrix-red mt-1 break-words">
                    error: {e.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.last_error ? (
                  <Chip tone="red">failing</Chip>
                ) : e.last_refreshed_at ? (
                  <Chip tone="green">ok</Chip>
                ) : (
                  <Chip tone="amber">pending</Chip>
                )}
                <Button
                  variant="ghost"
                  onClick={() =>
                    start.mutate({
                      command: "knowledge.fetch",
                      agent,
                      source: e.sourceId,
                    })
                  }
                >
                  refresh
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Header({ agent }: { agent: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
        // refresh history for {agent}
      </div>
      <Link
        to={`/agents/${agent}?tab=knowledge`}
        className="font-mono text-[11px] text-matrix-green-muted hover:text-matrix-green underline"
      >
        edit sources →
      </Link>
    </div>
  );
}
