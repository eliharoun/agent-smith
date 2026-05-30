import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export type EditorTabId =
  | "identity"
  | "expertise"
  | "soul"
  | "user"
  | "targets"
  | "permissions"
  | "skills"
  | "knowledge";

interface Props {
  tabs: { id: EditorTabId; label: string; element: ReactNode }[];
  initial?: EditorTabId;
}

/**
 * Tabs primitive for /agents/:name. Active tab is driven by the `?tab=`
 * query param (mirroring SkillEditorTabs) so back/forward + deep links
 * work. Falls back to `initial` (default "identity") when the param is
 * missing or unrecognized.
 *
 * Task 26's `KnowledgeAgentRedirect` and KnowledgeIndex's per-row link
 * navigate to `/agents/:name?tab=knowledge`, which selects the Knowledge
 * tab on this primitive (added in Task 29).
 */
export function AgentEditorTabs({ tabs, initial = "identity" }: Props) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active: EditorTabId = tabs.some((t) => t.id === raw) ? (raw as EditorTabId) : initial;
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
