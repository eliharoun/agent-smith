import { useEffect, useState } from "react";
import { useJobHistorySearch } from "@/hooks/useJobHistorySearch";
import { Card } from "@/ui/Card";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Searches captured job output via `/api/history/search?q=…`. Debounces the
 * input by 300ms so each keystroke doesn't hammer the server's grep walk.
 * Results below the 2-character minimum are hidden (the hook itself
 * disables the underlying query, so no network call is made either).
 */
export function JobSearchBar({ onJump }: { onJump: (jobId: string) => void }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const search = useJobHistorySearch(debounced);

  return (
    <Card>
      <input
        type="text"
        placeholder="search past job output…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="bg-transparent border border-matrix-line px-2 py-1 font-mono text-sm w-full text-matrix-body focus:outline-none focus:border-matrix-green-muted"
      />
      {debounced.length >= 2 && (
        <div className="mt-2 max-h-64 overflow-y-auto">
          {search.isLoading && (
            <div className="font-mono text-xs text-matrix-green-muted">// searching…</div>
          )}
          {search.data?.length === 0 && (
            <div className="font-mono text-xs text-matrix-green-muted">// no matches</div>
          )}
          {search.data?.map((hit, i) => (
            <button
              type="button"
              // biome-ignore lint/suspicious/noArrayIndexKey: composite key + index is stable for a given response
              key={`${hit.jobId}:${hit.lineNumber}:${i}`}
              onClick={() => onJump(hit.jobId)}
              className="block w-full text-left p-1 hover:bg-matrix-green/5 border-t border-matrix-line/30"
            >
              <div className="font-mono text-[10px] text-matrix-green-muted">
                {hit.jobId}:{hit.lineNumber}
              </div>
              <div className="font-mono text-xs whitespace-pre text-matrix-body">
                {hit.matchedLine}
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
