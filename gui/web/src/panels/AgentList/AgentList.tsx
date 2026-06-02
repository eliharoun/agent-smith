import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deriveRemotePathWeb } from "@/lib/remote-path";
import { REMOTE_ROOT_DISPLAY } from "@/lib/remote-root-display";
import { AsciiGlyph } from "@/ui/AsciiGlyph";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { CollapsibleCatalogGroup } from "@/ui/CollapsibleCatalogGroup";
import { ListRow } from "@/ui/ListRow";
import { RemoteBadge } from "../RemoteBadge";
import { RemoteSyncConfirm } from "../RemoteSyncConfirm";
import { type AgentListRow, useAgentListData } from "./useAgentListData";

/**
 * Renders agents grouped by their source catalog. Per row:
 *   - name (links to /agents/:name)
 *   - description (truncated)
 *   - one chip per target platform; tone=green when installed there.
 *
 * Sticky filter input narrows visible rows by name or description.
 * A catalog-chip strip above the filter narrows to a single catalog
 * (or "all"). Each catalog group is wrapped in CollapsibleCatalogGroup
 * so users can collapse noisy catalogs; open/closed state persists in
 * localStorage. Rows share the ListRow grid template so columns align.
 */
export function AgentList() {
  const { byCatalog, loading } = useAgentListData();
  const [q, setQ] = useState("");
  const [activeCatalog, setActiveCatalog] = useState<string | null>(null);
  // C4.7.2: sync confirm dialog target (null when closed).
  const [syncTarget, setSyncTarget] = useState<AgentListRow | null>(null);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const scoped = byCatalog.filter(
      (g) => activeCatalog === null || g.catalogLabel === activeCatalog,
    );
    if (!needle) return scoped;
    return scoped
      .map((g) => ({
        ...g,
        rows: g.rows.filter(
          (a) =>
            a.name.toLowerCase().includes(needle) ||
            (a.description ?? "").toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [byCatalog, q, activeCatalog]);

  if (loading) return <Card>scanning…</Card>;

  if (byCatalog.length === 0) {
    return (
      <Card>
        <div className="text-matrix-green-muted text-sm">
          No agents yet.{" "}
          <Link className="text-matrix-green" to="/agents/new">
            Create one
          </Link>
          .
        </div>
      </Card>
    );
  }

  const chipBase = "font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border";
  const chipActive = "border-matrix-green text-matrix-green";
  const chipIdle = "border-matrix-line text-matrix-body hover:text-matrix-green";

  return (
    <Card>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm pb-2 mb-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // agents
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            type="button"
            onClick={() => setActiveCatalog(null)}
            className={`${chipBase} ${activeCatalog === null ? chipActive : chipIdle}`}
          >
            all
          </button>
          {byCatalog.map((g) => (
            <button
              key={g.catalogLabel}
              type="button"
              data-chip={g.catalogLabel}
              onClick={() => setActiveCatalog(g.catalogLabel)}
              className={`${chipBase} ${activeCatalog === g.catalogLabel ? chipActive : chipIdle}`}
            >
              {g.catalogLabel}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter by name or description…"
          aria-label="Filter agents"
          className="w-full bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
        />
      </div>
      <div>
        {visible.map((group) => (
          <CollapsibleCatalogGroup
            key={group.catalogLabel}
            label={group.catalogLabel}
            count={group.rows.length}
            defaultOpen
            storageKey={`agents:${group.catalogLabel}:open`}
          >
            <ul className="flex flex-col">
              {group.rows.map((a) => {
                const behind =
                  a.remote?.lastRemoteSha !== undefined &&
                  a.remote.lastRemoteSha !== a.remote.lastPulledSha;
                return (
                  <ListRow
                    key={a.name}
                    columns="auto minmax(14rem,18rem) 1fr auto auto"
                    className={`py-2 ${behind ? "bg-matrix-amber/[0.03]" : ""}`}
                  >
                    <AsciiGlyph name="agents" className="text-matrix-body" />
                    <Link
                      to={`/agents/${encodeURIComponent(a.name)}`}
                      className="font-mono text-sm text-matrix-body hover:text-matrix-green truncate"
                    >
                      {a.name}
                    </Link>
                    <span className="font-mono text-xs text-matrix-green-muted truncate">
                      {a.description}
                    </span>
                    <div className="flex gap-1">
                      {a.targets.map((t) => (
                        <Chip
                          key={t}
                          tone={
                            t !== "agents-md" && a.installed[t]
                              ? "green"
                              : "neutral"
                          }
                        >
                          {t}
                        </Chip>
                      ))}
                    </div>
                    <RemoteBadge remote={a.remote} onClick={() => setSyncTarget(a)} />
                  </ListRow>
                );
              })}
            </ul>
          </CollapsibleCatalogGroup>
        ))}
      </div>
      {syncTarget?.remote && (
        <RemoteSyncConfirm
          kind="agent"
          name={syncTarget.name}
          url={syncTarget.remote.url}
          gitRef={syncTarget.remote.ref ?? null}
          cloneDir={safeDerivePath(syncTarget.remote.url)}
          open
          onClose={() => setSyncTarget(null)}
        />
      )}
    </Card>
  );
}

/**
 * Best-effort clone-path display string. If the URL doesn't parse we fall
 * back to the bare URL — the dialog is informational and the daemon resolves
 * the real on-disk path itself.
 */
function safeDerivePath(url: string): string {
  try {
    return deriveRemotePathWeb(url, REMOTE_ROOT_DISPLAY);
  } catch {
    return url;
  }
}
