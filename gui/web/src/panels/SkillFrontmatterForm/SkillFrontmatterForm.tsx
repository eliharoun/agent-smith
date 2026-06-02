import type { SkillFrontmatter } from "gui-shared";
import { Card } from "@/ui/Card";

interface Props {
  frontmatter: SkillFrontmatter;
}

/**
 * Read-only YAML key/value view of the skill's frontmatter. The CLI does not
 * provide a `smith skill edit` command, so the GUI directs users to edit on
 * disk. The "edit on disk" banner makes the constraint explicit.
 *
 * Renders all top-level keys, not just `name`/`description`. Object/array
 * values are JSON-stringified for compactness.
 */
export function SkillFrontmatterForm({ frontmatter }: Props) {
  const entries = Object.entries(frontmatter);
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-amber mb-2">
        // skills are edited on disk — open in your editor to modify
      </div>
      {entries.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body">// (empty frontmatter)</div>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-matrix-green-muted uppercase tracking-wider">{k}</dt>
              <dd className="text-matrix-body break-all">
                {typeof v === "string" ? v : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
