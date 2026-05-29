import { Link } from "react-router-dom";
import { useAllRefreshSummaries } from "@/hooks/useAllRefreshSummaries";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

/**
 * Landing screen for /knowledge — an agent picker. Each row links into
 * the agent editor's Knowledge tab (/agents/:name?tab=knowledge) which is
 * the canonical editing surface (see Task 29). Reuses the bulk summary
 * endpoint from Task 26 so we don't duplicate I/O.
 *
 * Sort: failing first, then most-recently-refreshed, then by name —
 * same as RefreshHistoryIndex to keep behavior consistent.
 */
export function KnowledgeIndex() {
  const q = useAllRefreshSummaries();

  if (q.isLoading) {
    return (
      <Card>
        <Header />
        <div className="font-mono text-sm text-matrix-body">// loading agents…</div>
      </Card>
    );
  }
  if (q.isError) {
    return (
      <Card>
        <Header />
        <div className="font-mono text-sm text-matrix-red">
          // failed to load — {(q.error as Error).message}
        </div>
        <Button variant="ghost" onClick={() => q.refetch()}>
          retry
        </Button>
      </Card>
    );
  }

  const summaries = [...(q.data?.summaries ?? [])].sort((a, b) => {
    if ((b.failingCount > 0 ? 1 : 0) !== (a.failingCount > 0 ? 1 : 0)) {
      return (b.failingCount > 0 ? 1 : 0) - (a.failingCount > 0 ? 1 : 0);
    }
    const ta = a.lastRefreshAt ? Date.parse(a.lastRefreshAt) : 0;
    const tb = b.lastRefreshAt ? Date.parse(b.lastRefreshAt) : 0;
    if (tb !== ta) return tb - ta;
    return a.agent.localeCompare(b.agent);
  });

  return (
    <Card>
      <Header />
      {summaries.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body py-4">
          // no agents registered yet —{" "}
          <Link to="/agents/new" className="text-matrix-green underline">
            create one
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y divide-matrix-line">
          {summaries.map((s) => (
            <li key={s.agent} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  to={`/agents/${s.agent}?tab=knowledge`}
                  className="font-mono text-sm text-matrix-green hover:underline"
                >
                  {s.agent}
                </Link>
                <div className="font-mono text-[11px] text-matrix-green-muted mt-1 flex flex-wrap gap-x-3">
                  <span>sources: {s.sourceCount}</span>
                  <span title={s.lastRefreshAt ?? ""}>
                    last refresh: {relativeTime(s.lastRefreshAt)}
                  </span>
                  {s.failingCount > 0 && (
                    <span className="text-matrix-red">failing: {s.failingCount}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {s.failingCount > 0 ? (
                  <Chip tone="red">{s.failingCount} failing</Chip>
                ) : s.sourceCount === 0 ? (
                  <Chip tone="neutral">empty</Chip>
                ) : s.lastRefreshAt ? (
                  <Chip tone="green">ok</Chip>
                ) : (
                  <Chip tone="amber">pending</Chip>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Header() {
  return (
    <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-3">
      // pick an agent to manage knowledge sources
    </div>
  );
}
