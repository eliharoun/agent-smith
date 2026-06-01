import { useDoctor } from "@/hooks/useDoctor";
import { useStartJob } from "@/hooks/useStartJob";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

const FIXABLE = new Set(["missing-hook", "orphaned-consent", "corrupt-cache"]);

/**
 * Shows when `smith doctor` reports at least one auto-repairable finding —
 * either a knowledgeRefresh drift (missing-hook, orphaned-consent,
 * corrupt-cache) or a mcp-spawn-commands fragile-spawn entry.
 * `unmanaged-codex-hooks` is excluded — it is fixed via the dedicated
 * CodexMigrationBanner. Click dispatches `doctor` with the relevant fix
 * flags set; the global JobStreamModal renders progress.
 */
export function DoctorFixButton() {
  const q = useDoctor();
  const start = useStartJob();

  if (!q.data || "error" in q.data) return null;
  const kr = q.data.knowledgeRefresh as { findings?: Array<{ kind: string }> } | undefined;
  const mcp = q.data.mcpSpawnCommands as { findings?: Array<unknown> } | undefined;
  const hasKnowledgeRefreshFix = kr?.findings?.some((f) => FIXABLE.has(f.kind)) ?? false;
  const hasMcpSpawnFix = (mcp?.findings?.length ?? 0) > 0;
  if (!hasKnowledgeRefreshFix && !hasMcpSpawnFix) return null;

  const onFix = () => {
    start.mutate({
      command: "doctor",
      fixKnowledgeRefresh: hasKnowledgeRefreshFix,
      fixKnowledgeCompile: false,
      fixMcpCommands: hasMcpSpawnFix,
    });
  };

  // Build a one-line label that names what will be repaired so the button
  // text reflects the user's actual situation rather than always promising
  // "knowledge-refresh drift".
  const labelParts: string[] = [];
  if (hasKnowledgeRefreshFix) labelParts.push("knowledge-refresh drift");
  if (hasMcpSpawnFix) labelParts.push("MCP spawn commands");
  const label = `auto-repair ${labelParts.join(" + ")}`;

  return (
    <Card>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onFix} disabled={start.isPending}>
          {label}
        </Button>
        <span className="font-mono text-xs text-matrix-green-muted">
          runs `smith doctor` with the matching --fix-* flags
        </span>
      </div>
    </Card>
  );
}
