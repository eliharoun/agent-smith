import type { CatalogEntry, RegistryKind } from "gui-shared";
import { useMemo, useState } from "react";
import { useCatalogs } from "@/hooks/useCatalogs";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { FormField } from "@/ui/FormField";
import { TypedTokenModal } from "@/ui/TypedTokenModal";

type Filter = "all" | RegistryKind;

const GLYPHS: Record<RegistryKind, string> = { agent: "◆", skill: "◈" };

// Single source of truth for the catalog-table column tracks. Used by
// the one outer CSS grid that owns the column-width resolution. The
// header bar and every row are wrapped in `display: contents` so their
// cells become direct grid items of this parent grid — that's what
// keeps the header text and row content vertically aligned even when
// the kind column grows to fit two chips (kind + mode badge). Without
// the single grid, the header had its own auto-sized "kind" column
// which collapsed to the 4-char header text width while the row's
// `auto` column inflated to fit the chips, dragging every subsequent
// column out of alignment (rc.2 GUI bug-fix).
const GRID_COLS = "minmax(8rem,12rem) auto minmax(12rem,2fr) minmax(12rem,2fr) auto auto";

/**
 * Combined agent + skill catalog manager. Filter chips at the top narrow
 * by registry; rows show registry glyph, kind, label, root, git remote,
 * and a small health badge with bundle/skill count.
 *
 * Per-row actions:
 *   rename — modal with newLabel field, then typed-token confirm. Dispatches
 *            agent.catalog-rename for agent registry; skill registry catalogs
 *            do not have a rename command in the CLI (the file is named
 *            differently), so the rename button is disabled with a tooltip
 *            explaining the gap.
 *   unregister — typed-token confirm. Dispatches agent.unregister or
 *                skill.unregister based on registryKind.
 *
 * Protected catalogs show both buttons disabled.
 *
 * JobCompletionListener invalidates ['catalogs'] on agent.register/
 * unregister/catalog-rename and skill.* (see Task 19), so the list
 * refreshes automatically.
 */
export function CatalogList() {
  const [filter, setFilter] = useState<Filter>("all");
  const q = useCatalogs(filter === "all" ? undefined : filter);
  const start = useStartJob();
  const [pendingDel, setPendingDel] = useState<CatalogEntry | null>(null);
  const [pendingRename, setPendingRename] = useState<{
    catalog: CatalogEntry;
    newLabel: string;
  } | null>(null);

  const rows = useMemo(() => q.data ?? [], [q.data]);

  if (q.isLoading) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">// scanning catalogs…</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // catalogs
        </div>
        <div className="flex gap-2">
          {(["all", "agent", "skill"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border ${
                filter === f
                  ? "border-matrix-green text-matrix-green"
                  : "border-matrix-line text-matrix-body"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body">
          // no catalogs match the current filter
        </div>
      ) : (
        // One outer grid owns the column-track widths. Header and rows
        // each project their cells into this grid via `display: contents`
        // (the `contents` className below). data-testid kept on row
        // wrappers so existing tests (truncation, badge presence,
        // confirm-modal targeting) keep finding rows by label.
        <div
          className="grid items-stretch gap-x-4 font-mono text-sm"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          <div className="contents text-[10px] uppercase tracking-widest text-matrix-green-muted">
            <div className="py-1">label</div>
            <div className="py-1">kind</div>
            <div className="py-1">root</div>
            <div className="py-1">remote</div>
            <div className="py-1">health</div>
            <div className="py-1 text-right">actions</div>
          </div>
          {rows.map((c) => {
            const isAgent = c.registryKind === "agent";
            const count = isAgent ? c.health.bundleCount : c.health.skillCount;
            return (
              <div
                key={`${c.registryKind}:${c.label}`}
                data-testid="catalog-row"
                data-label={c.label}
                className="contents"
              >
                <span className="truncate py-2 border-t border-matrix-line" title={c.label}>
                  <span className="text-matrix-green-muted">{GLYPHS[c.registryKind]}</span>{" "}
                  {c.label}
                </span>
                <div className="py-2 border-t border-matrix-line">
                  <Chip>{c.kind}</Chip>{" "}
                  <Chip tone={c.mode === "managed" ? "green" : "neutral"}>{c.mode}</Chip>
                </div>
                <span
                  className="truncate text-matrix-green-muted py-2 border-t border-matrix-line"
                  title={c.rootPath}
                >
                  {c.rootPath}
                </span>
                <span
                  className="truncate text-matrix-green-muted py-2 border-t border-matrix-line"
                  title={c.gitRemote ?? "—"}
                >
                  {c.gitRemote ?? "—"}
                </span>
                <div className="flex gap-1 items-center py-2 border-t border-matrix-line">
                  <Chip tone={c.health.exists ? "green" : "red"}>
                    {c.health.exists ? "ok" : "missing"}
                  </Chip>
                  <span className="text-matrix-green-muted">{count ?? 0}</span>
                </div>
                <div className="flex gap-2 justify-end items-center py-2 border-t border-matrix-line">
                  <Button
                    variant="ghost"
                    disabled={c.protected || !isAgent}
                    onClick={() => setPendingRename({ catalog: c, newLabel: c.label })}
                    title={
                      !isAgent
                        ? "skill catalog rename is not yet supported by the CLI"
                        : c.protected
                          ? "protected catalog"
                          : "rename"
                    }
                  >
                    rename
                  </Button>
                  <Button
                    variant="danger"
                    disabled={c.protected}
                    onClick={() => setPendingDel(c)}
                    title={c.protected ? "protected catalog" : "unregister"}
                  >
                    unregister
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDel && (
        <TypedTokenModal
          title={`Unregister catalog "${pendingDel.label}"`}
          expectedToken={pendingDel.label}
          body={
            <>
              Removes the catalog from{" "}
              <code>
                {pendingDel.registryKind === "agent"
                  ? "agent-registry.json"
                  : "skill-catalogs.json"}
              </code>
              . Files on disk are not deleted.
            </>
          }
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            const isAgent = pendingDel.registryKind === "agent";
            start.mutate(
              isAgent
                ? { command: "agent.unregister", pathOrLabel: pendingDel.label }
                : { command: "skill.unregister", pathOrLabel: pendingDel.label },
            );
            setPendingDel(null);
          }}
        />
      )}

      {pendingRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="border border-matrix-green bg-black p-6 w-full max-w-md">
            <h2 className="font-mono text-matrix-green uppercase tracking-widest text-sm mb-3">
              // Rename catalog
            </h2>
            <div className="space-y-3">
              <FormField
                label="Current label"
                value={pendingRename.catalog.label}
                disabled
                readOnly
              />
              <FormField
                label="New label"
                value={pendingRename.newLabel}
                onChange={(e) =>
                  setPendingRename((prev) => (prev ? { ...prev, newLabel: e.target.value } : prev))
                }
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setPendingRename(null)}>
                Cancel
              </Button>
              <Button
                disabled={
                  !pendingRename.newLabel || pendingRename.newLabel === pendingRename.catalog.label
                }
                onClick={() => {
                  // Skill catalog rename not supported by CLI; button is
                  // disabled on the row when registryKind !== "agent",
                  // so by this point we can safely dispatch agent.catalog-rename.
                  start.mutate({
                    command: "agent.catalog-rename",
                    oldLabel: pendingRename.catalog.label,
                    newLabel: pendingRename.newLabel,
                  });
                  setPendingRename(null);
                }}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
