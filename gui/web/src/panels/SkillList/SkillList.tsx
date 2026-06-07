import type { SkillSummary } from "gui-shared";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useJobToast } from "@/hooks/useJobToast";
import { deriveRemotePathWeb } from "@/lib/remote-path";
import { REMOTE_ROOT_DISPLAY } from "@/lib/remote-root-display";
import { AsciiGlyph } from "@/ui/AsciiGlyph";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { CollapsibleCatalogGroup } from "@/ui/CollapsibleCatalogGroup";
import { ListRow } from "@/ui/ListRow";
import { RemoteBadge } from "../RemoteBadge";
import { RemoteSyncConfirm } from "../RemoteSyncConfirm";
import { useSkillListData } from "./useSkillListData";

const PLATFORMS = ["opencode", "claude-code", "codex", "kiro"] as const;

/**
 * Renders skills grouped by their source catalog. Per row:
 *   - name (links to /skills/:name)
 *   - description (truncated)
 *   - one chip per platform; tone=green when installed on that platform,
 *     neutral otherwise. Installed status comes from
 *     installed-skills.json via useInstalledSkills().
 *
 * Sticky filter input narrows visible rows by name or description.
 * Each catalog group is wrapped in CollapsibleCatalogGroup so users can
 * collapse noisy catalogs; open/closed state persists in localStorage.
 * Rows use the shared ListRow grid template so the description column
 * starts at the same x-coordinate across all rows.
 *
 * Empty state: directs the user to bootstrap or register a catalog.
 */
export function SkillList() {
  const { byCatalog, installedByName, loading, total } = useSkillListData();
  const [q, setQ] = useState("");
  // C4.7.3: sync confirm dialog target (null when closed).
  const [syncTarget, setSyncTarget] = useState<SkillSummary | null>(null);

  // Label closures capture syncTarget?.name at dispatch time, so the toast
  // always references the name that was confirmed even if the user clicks
  // another row before the job completes.
  const syncToast = useJobToast({
    command: "skill.sync",
    label: {
      progress: () => `Syncing ${syncTarget?.name ?? "skill"}…`,
      success: () => `Synced ${syncTarget?.name ?? "skill"}`,
      error: () => "Sync failed",
    },
    dedupKey: `job-toast:skill.sync:${syncTarget?.name ?? ""}`,
  });

  const filteredByCatalog = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return byCatalog;
    return byCatalog
      .map((g) => ({
        ...g,
        rows: g.rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.description ?? "").toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [byCatalog, q]);

  if (loading) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">// scanning skills…</div>
      </Card>
    );
  }

  if (total === 0) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">
          // no skills registered yet — bootstrap or{" "}
          <Link className="text-matrix-green" to="/skills?add=true">
            register a catalog
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm pb-2 mb-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // skills
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter by name or description…"
          aria-label="Filter skills"
          className="w-full bg-black border border-matrix-line px-2 py-1 font-mono text-sm text-matrix-body focus:outline-none focus:border-matrix-green focus:shadow-matrix-focus"
        />
      </div>
      <div>
        {filteredByCatalog.map((group) => (
          <CollapsibleCatalogGroup
            key={group.catalogLabel}
            label={group.catalogLabel}
            count={group.rows.length}
            defaultOpen
            storageKey={`skills:${group.catalogLabel}:open`}
          >
            <ul className="flex flex-col">
              {group.rows.map((s) => {
                const inst = installedByName.get(s.name);
                const behind =
                  s.remote?.lastRemoteSha !== undefined &&
                  s.remote.lastRemoteSha !== s.remote.lastPulledSha;
                return (
                  <ListRow
                    key={s.name}
                    columns="auto minmax(14rem,18rem) 1fr auto auto"
                    className={`py-2 ${behind ? "bg-matrix-amber/[0.03]" : ""}`}
                  >
                    <AsciiGlyph name="skills" className="text-matrix-body" />
                    <Link
                      to={`/skills/${encodeURIComponent(s.name)}`}
                      className="font-mono text-sm text-matrix-body hover:text-matrix-green truncate"
                    >
                      {s.name}
                    </Link>
                    <span className="font-mono text-xs text-matrix-green-muted truncate">
                      {s.description}
                    </span>
                    <div className="flex gap-1">
                      {PLATFORMS.map((p) => {
                        const key = p === "claude-code" ? "claudeCode" : p;
                        const installed = Boolean(
                          inst?.installedPaths[key as "opencode" | "claudeCode" | "codex"],
                        );
                        return (
                          <Chip key={p} tone={installed ? "green" : "neutral"}>
                            {p}
                          </Chip>
                        );
                      })}
                    </div>
                    <RemoteBadge remote={s.remote} onClick={() => setSyncTarget(s)} />
                  </ListRow>
                );
              })}
            </ul>
          </CollapsibleCatalogGroup>
        ))}
      </div>
      {syncTarget?.remote && (
        <RemoteSyncConfirm
          kind="skill"
          name={syncTarget.name}
          url={syncTarget.remote.url}
          gitRef={syncTarget.remote.ref ?? null}
          cloneDir={safeDerivePath(syncTarget.remote.url)}
          open
          onClose={() => setSyncTarget(null)}
          onDispatch={syncToast.dispatch}
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
