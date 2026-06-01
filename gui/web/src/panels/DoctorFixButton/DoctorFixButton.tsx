import { useDoctor } from "@/hooks/useDoctor";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

const FIXABLE = new Set(["missing-hook", "orphaned-consent", "corrupt-cache"]);

/**
 * Shows when `smith doctor`'s knowledgeRefresh section has at least one
 * auto-repairable finding (missing-hook, orphaned-consent, corrupt-cache).
 * `unmanaged-codex-hooks` is excluded — it is fixed via the dedicated
 * CodexMigrationBanner. Click dispatches `doctor` with
 * `fixKnowledgeRefresh: true`; the global JobStreamModal renders progress.
 */
export function DoctorFixButton() {
  const q = useDoctor();
  const start = useStartJob();

  if (!q.data || "error" in q.data) return null;
  const kr = q.data.knowledgeRefresh as { findings?: Array<{ kind: string }> } | undefined;
  const hasFixable = kr?.findings?.some((f) => FIXABLE.has(f.kind)) ?? false;
  if (!hasFixable) return null;

  const onFix = () => {
    start.mutate({
      command: "doctor",
      fixKnowledgeRefresh: true,
      fixKnowledgeCompile: false,
    });
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onFix} disabled={start.isPending}>
          auto-repair knowledge-refresh drift
        </Button>
        <span className="font-mono text-xs text-matrix-green-muted">
          runs `smith doctor --fix-knowledge-refresh`
        </span>
      </div>
    </Card>
  );
}
