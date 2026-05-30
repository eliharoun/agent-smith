import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export type SkillTabId = "frontmatter" | "body" | "resources";

interface Props {
  tabs: { id: SkillTabId; label: string; element: ReactNode }[];
  initial?: SkillTabId;
}

/**
 * Tabs primitive for /skills/:name. Active tab is driven by the `?tab=` query
 * param so back/forward + deep links work. Falls back to `initial` (default
 * "frontmatter") when the param is missing or unrecognized.
 *
 * Parallel to AgentEditorTabs (whose tab IDs differ); kept separate per plan
 * to avoid widening the EditorTabId union.
 */
export function SkillEditorTabs({ tabs, initial = "frontmatter" }: Props) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active: SkillTabId = tabs.some((t) => t.id === raw) ? (raw as SkillTabId) : initial;
  const current = tabs.find((t) => t.id === active);
  return (
    <div className="flex gap-4">
      <ul className="w-40 border-r border-matrix-line pr-2 space-y-1">
        {tabs.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("tab", t.id);
                setParams(next, { replace: true });
              }}
              className={`w-full text-left px-2 py-1 font-mono text-xs uppercase tracking-wider ${
                active === t.id
                  ? "text-matrix-green border-l-2 border-matrix-green"
                  : "text-matrix-body"
              }`}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex-1 min-w-0">{current?.element}</div>
    </div>
  );
}
