import type { AgentDetail } from "gui-shared";
import { useAgent } from "@/hooks/useAgents";
import { Card } from "@/ui/Card";

interface RequiredSkill {
  catalog?: string;
  name: string;
}

function isRequiredSkill(v: unknown): v is RequiredSkill {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && (o.catalog === undefined || typeof o.catalog === "string");
}

/**
 * Read-only view of the agent's required skills (config.requires.skills).
 *
 * Replaces the Phase 1 "Configuration UI ships in Phase 2" placeholder.
 * Pure display — see AgentPermissionsView for the rationale.
 *
 * `requires.skills` is `Array<{ catalog?: string; name: string }>` per
 * `RequiresSchema` in src/core/config-schema.ts. The GUI treats this as
 * untyped at the boundary and filters defensively.
 */
export function AgentSkillsView({ agentName }: { agentName: string }) {
  const q = useAgent(agentName);
  if (q.isLoading) return <Card>loading…</Card>;
  if (!q.data) return <Card>agent not found</Card>;
  const detail: AgentDetail = q.data;
  const requires = detail.config.requires as { skills?: unknown[] | undefined } | undefined;
  const raw = requires?.skills ?? [];
  const skills: RequiredSkill[] = Array.isArray(raw) ? raw.filter(isRequiredSkill) : [];

  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // required skills
      </div>
      {skills.length === 0 ? (
        <p className="text-matrix-body text-sm">No required skills declared.</p>
      ) : (
        <ul className="space-y-1 font-mono text-xs">
          {skills.map((s) => (
            <li key={`${s.catalog ?? ""}/${s.name}`} className="flex items-center gap-2">
              <span className="text-matrix-green">{s.name}</span>
              {s.catalog ? <span className="text-matrix-green-muted">[{s.catalog}]</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-matrix-green-muted text-[11px]">
        Read-only. Edit <code className="text-matrix-green">{detail.path}/agent.config.json</code>{" "}
        to modify.
      </div>
    </Card>
  );
}
