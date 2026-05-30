import { Link } from "react-router-dom";
import { useAllRefreshSummaries } from "@/hooks/useAllRefreshSummaries";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

/**
 * Refresh history landing — agent picker. Lists every registered agent with
 * a compact summary row (last-refresh, source count, failing count) and a
 * link into /knowledge/:agent/refresh-history.
 *
 * Sort: failing first, then most-recently-refreshed, then by name.
 */
export function RefreshHistoryIndex() {
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
        <div className="font-mono text-sm text-matrix-body py-4">// no agents registered yet.</div>
      ) : (
        <ul className="divide-y divide-matrix-line">
          {summaries.map((s) => (
            <li key={s.agent} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  to={`/knowledge/${s.agent}/refresh-history`}
                  className="font-mono text-sm text-matrix-green hover:underline"
                >
                  {s.agent}
                </Link>
                <div className="font-mono text-[11px] text-matrix-green-muted mt-1 flex flex-wrap gap-x-3">
                  <span title={s.lastRefreshAt ?? ""}>
                    last refresh: {relativeTime(s.lastRefreshAt)}
                  </span>
                  <span>sources: {s.sourceCount}</span>
                  {s.failingCount > 0 && (
                    <span className="text-matrix-red">failing: {s.failingCount}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
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
    <div className="flex items-center justify-between mb-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
        // refresh history — pick an agent
      </div>
    </div>
  );
}
