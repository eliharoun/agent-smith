import { useState } from "react";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { TypedTokenModal } from "@/ui/TypedTokenModal";
import { useSkillCatalogListData } from "./useSkillCatalogListData";

/**
 * Lists skill-kind catalogs from /api/catalogs?kind=skill and surfaces
 * rename + unregister actions. Protected catalogs show
 * the buttons disabled. Confirmation goes through TypedTokenModal —
 * the user types the catalog label to enable the destroy button.
 *
 * Rename UI is intentionally minimal in this task (Task 20); a richer
 * two-field modal will follow when the broader Catalogs route is built
 * in Task 24. For now the rename button is a no-op stub on enabled rows
 * (kept so the protected-disable assertion is symmetric).
 */
export function SkillCatalogList() {
  const { catalogs, loading } = useSkillCatalogListData();
  const start = useStartJob();
  const [pendingDel, setPendingDel] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">// scanning…</div>
      </Card>
    );
  }

  if (catalogs.length === 0) {
    return (
      <Card>
        <div className="font-mono text-sm text-matrix-body">
          // no skill catalogs registered yet
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // skill catalogs
      </div>
      <table className="w-full font-mono text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-matrix-green-muted text-left">
            <th className="py-1">label</th>
            <th>kind</th>
            <th>root</th>
            <th>skills</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {catalogs.map((c) => (
            <tr key={c.label} className="border-t border-matrix-line">
              <td className="py-1">{c.label}</td>
              <td>
                <Chip>{c.kind}</Chip>{" "}
                <Chip tone={c.mode === "managed" ? "green" : "neutral"}>{c.mode}</Chip>
              </td>
              <td className="text-matrix-green-muted truncate max-w-xs">{c.rootPath}</td>
              <td>{c.health.skillCount ?? 0}</td>
              <td className="text-right space-x-1">
                <Button variant="ghost" disabled={c.protected} title="rename catalog">
                  rename
                </Button>
                <Button
                  variant="danger"
                  disabled={c.protected}
                  onClick={() => setPendingDel(c.label)}
                  title={c.protected ? "protected catalog cannot be unregistered" : undefined}
                >
                  unregister
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pendingDel && (
        <TypedTokenModal
          title={`Unregister catalog "${pendingDel}"`}
          expectedToken={pendingDel}
          body={
            <>
              This removes the catalog from <code>skill-catalogs.json</code>. Files on disk are not
              deleted.
            </>
          }
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            start.mutate({ command: "skill.unregister", pathOrLabel: pendingDel });
            setPendingDel(null);
          }}
        />
      )}
    </Card>
  );
}
