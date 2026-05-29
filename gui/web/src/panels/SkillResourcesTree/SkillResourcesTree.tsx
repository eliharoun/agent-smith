import type { SkillResource } from "gui-shared";
import { Card } from "@/ui/Card";

interface Props {
  resources: SkillResource[];
}

/**
 * Read-only indented file tree from SkillDetail.resources. Items are sorted
 * by `relPath` for a stable order; depth is inferred from path segment count.
 * Directories render with a trailing slash; files render their byte size when
 * provided.
 */
export function SkillResourcesTree({ resources }: Props) {
  const sorted = [...resources].sort((a, b) => a.relPath.localeCompare(b.relPath));
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // resources
      </div>
      {sorted.length === 0 ? (
        <div className="font-mono text-sm text-matrix-body">// (no bundled resources)</div>
      ) : (
        <ul className="font-mono text-xs">
          {sorted.map((r) => {
            const segments = r.relPath.split("/").filter(Boolean);
            const depth = Math.max(0, segments.length - 1);
            const leaf = segments[segments.length - 1] ?? r.relPath;
            return (
              <li
                key={r.relPath}
                className="text-matrix-body py-0.5"
                style={{ paddingLeft: `${depth * 1.25}rem` }}
              >
                <span className="text-matrix-green-muted">{r.isDirectory ? "▸" : "·"}</span>{" "}
                <span>{r.isDirectory ? `${leaf}/` : leaf}</span>
                {!r.isDirectory && typeof r.bytes === "number" && (
                  <span className="text-matrix-green-muted ml-2">{r.bytes}b</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
