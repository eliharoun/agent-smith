import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Lamp } from "@/ui/Lamp";
import { useDoctorCheckListData } from "./useDoctorCheckListData";

export function DoctorCheckList() {
  const { checks, loading, error, refusal, refetch } = useDoctorCheckListData();
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // checks
        </div>
        <Button variant="ghost" onClick={() => refetch()}>
          Re-run
        </Button>
      </div>
      {loading && <div className="text-matrix-green-muted text-sm">scanning…</div>}
      {error && !loading && (
        <div className="font-mono text-sm text-matrix-red mb-2">
          doctor failed — {error instanceof Error ? error.message : String(error)}
        </div>
      )}
      {refusal && !loading && (
        <div className="font-mono text-sm text-matrix-red mb-2">
          no platform detected — install OpenCode/Claude Code/Codex
        </div>
      )}
      {!loading && !error && checks.length === 0 && (
        <div className="font-mono text-xs text-matrix-green-muted">no checks</div>
      )}
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-3">
            <Lamp status={c.status === "ok" ? "on" : c.status === "warn" ? "warn" : "error"} />
            <div>
              <div className="font-mono text-sm text-matrix-body">{c.label}</div>
              {c.detail && (
                <div className="font-mono text-xs text-matrix-green-muted">{c.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
