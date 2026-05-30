import type { AgentDetail } from "gui-shared";
import { useAgent } from "@/hooks/useAgents";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";

type Action = "allow" | "ask" | "deny";

function isAction(v: unknown): v is Action {
  return v === "allow" || v === "ask" || v === "deny";
}

function actionTone(a: Action): "green" | "amber" | "red" {
  if (a === "allow") return "green";
  if (a === "ask") return "amber";
  return "red";
}

/**
 * Read-only view of the agent's permission block (config.permission).
 *
 * Replaces the Phase 1 "Configuration UI ships in Phase 2" placeholder.
 * Pure display — no write endpoint exists yet; users are pointed at the
 * JSON file on disk for edits.
 *
 * The config is fetched via the existing `useAgent` hook which exposes
 * `config` as a loose `Record<string, unknown>` (canonical schema lives
 * in the CLI and the GUI intentionally avoids re-validating). We probe
 * the shape defensively: permission values are either a bare action
 * string (`allow`/`ask`/`deny`) or a per-pattern record mapping arbitrary
 * keys to action strings (see `PermissionGroupValue` in
 * src/core/config-schema.ts).
 */
export function AgentPermissionsView({ agentName }: { agentName: string }) {
  const q = useAgent(agentName);
  if (q.isLoading) return <Card>loading…</Card>;
  if (!q.data) return <Card>agent not found</Card>;
  const detail: AgentDetail = q.data;
  const permission = detail.config.permission as Record<string, unknown> | undefined;

  const groups = permission ? Object.entries(permission) : [];

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // permissions
      </div>
      {groups.length === 0 ? (
        <p className="text-matrix-body text-sm">No explicit permissions set — defaults apply.</p>
      ) : (
        <dl className="space-y-2 font-mono text-xs">
          {groups.map(([group, value]) => (
            <PermissionGroupRow key={group} group={group} value={value} />
          ))}
        </dl>
      )}
      <div className="mt-4 text-matrix-green-muted text-[11px]">
        Read-only. Edit <code className="text-matrix-green">{detail.path}/agent.config.json</code>{" "}
        to modify.
      </div>
    </Card>
  );
}

function PermissionGroupRow({ group, value }: { group: string; value: unknown }) {
  if (isAction(value)) {
    return (
      <div className="flex items-center gap-3">
        <dt className="text-matrix-green w-28 truncate" title={group}>
          {group}
        </dt>
        <dd>
          <Chip tone={actionTone(value)}>{value}</Chip>
        </dd>
      </div>
    );
  }
  if (value && typeof value === "object") {
    const sub = Object.entries(value as Record<string, unknown>);
    return (
      <div>
        <dt className="text-matrix-green">{group}</dt>
        <dd className="ml-4 mt-1 space-y-1">
          {sub.map(([pattern, action]) => (
            <div key={pattern} className="flex items-center gap-3">
              <span
                className="text-matrix-body w-44 truncate font-mono text-[11px]"
                title={pattern}
              >
                {pattern}
              </span>
              {isAction(action) ? (
                <Chip tone={actionTone(action)}>{action}</Chip>
              ) : (
                <span className="text-matrix-amber">unknown: {String(action)}</span>
              )}
            </div>
          ))}
        </dd>
      </div>
    );
  }
  // Defensive fallback for unexpected shapes.
  return (
    <div className="text-matrix-amber">
      <dt className="inline">{group}:</dt>{" "}
      <dd className="inline text-matrix-body">{String(value)}</dd>
    </div>
  );
}
