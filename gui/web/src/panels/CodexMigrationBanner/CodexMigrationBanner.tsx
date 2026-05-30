import { useDoctor } from "@/hooks/useDoctor";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

interface CodexHooksFinding {
  kind: "unmanaged-codex-hooks";
  path: string;
}

/**
 * Surfaces when `smith doctor`'s knowledgeRefresh section reports an
 * `unmanaged-codex-hooks` finding (a pre-existing ~/.codex/hooks.json
 * that lacks the smith ownership sentinel). One-click dispatches the
 * `knowledge.migrate-codex` job; the global JobStreamModal renders the
 * progress and exit. The doctor query is short-staled (30s) so it
 * naturally re-fetches after the modal closes.
 */
export function CodexMigrationBanner() {
  const q = useDoctor();
  const start = useStartJob();

  if (!q.data || "error" in q.data) return null;
  const kr = q.data.knowledgeRefresh as
    | { findings?: Array<{ kind: string; path?: string }> }
    | undefined;
  const finding = kr?.findings?.find(
    (f): f is CodexHooksFinding => f.kind === "unmanaged-codex-hooks",
  );
  if (!finding) return null;

  const onMigrate = () => {
    start.mutate({ command: "knowledge.migrate-codex" });
  };

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-amber mb-1">
        // codex hooks detected
      </div>
      <div className="font-mono text-sm mb-3 text-matrix-body">
        An unmanaged <code>codex/hooks.json</code> exists at{" "}
        <span className="text-matrix-green-muted">{finding.path}</span>. smith can claim management
        of it.
      </div>
      <Button variant="primary" onClick={onMigrate} disabled={start.isPending}>
        migrate codex hooks
      </Button>
    </Card>
  );
}
