import type { KnowledgeSource, RefreshCacheEntry } from "gui-shared";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";

interface Props {
  agent: string;
  source: KnowledgeSource;
  refreshCache?: RefreshCacheEntry | undefined;
  onRefresh: () => void;
  onRemove: () => void;
}

/**
 * One row per knowledge source. Renders type glyph + summary + last-refresh
 * chip + status lamp + actions. The summary string is type-specific
 * (path/url/space/jql/…) so users can identify sources without expanding.
 */
export function KnowledgeSourceRow({ source, refreshCache, onRefresh, onRemove }: Props) {
  const lastRefreshLabel = relativeTime(refreshCache?.last_refreshed_at);
  const status = refreshCache?.last_error
    ? ("error" as const)
    : refreshCache?.last_refreshed_at
      ? ("ok" as const)
      : ("never" as const);
  const summary = summarize(source);
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="font-mono text-matrix-green-muted text-sm w-4" aria-hidden>
        ≡
      </span>
      <Chip>{source.type}</Chip>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm text-matrix-body truncate">{source.id}</div>
        <div className="font-mono text-[10px] text-matrix-green-muted truncate">{summary}</div>
      </div>
      <span
        className="font-mono text-[10px] text-matrix-green-muted"
        title={refreshCache?.last_refreshed_at ?? "never refreshed"}
      >
        ↻ {lastRefreshLabel}
      </span>
      <Chip tone={status === "ok" ? "green" : status === "error" ? "red" : "neutral"}>
        {status === "ok" ? "ok" : status === "error" ? "err" : "—"}
      </Chip>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={onRefresh}>
          refresh
        </Button>
        <Button variant="danger" onClick={onRemove}>
          remove
        </Button>
      </div>
    </div>
  );
}

function summarize(source: KnowledgeSource): string {
  switch (source.type) {
    case "file":
    case "dir":
    case "glob":
      return source.path;
    case "url":
      return source.url;
    case "git": {
      const ref = source.ref ? `@${source.ref}` : "";
      const sub = source.subpath ? ` :${source.subpath}` : "";
      return `${source.url}${ref}${sub}`;
    }
    case "npm":
      return source.package;
    case "confluence":
      return `${source.space}${source.pages?.length ? ` (${source.pages.length} pages)` : ""}`;
    case "jira":
      return source.jql;
  }
}
