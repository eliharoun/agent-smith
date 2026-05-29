import type { PersonaFile } from "gui-shared";
import { useState } from "react";
import { useSavePersona } from "@/hooks/useAgents";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

interface Props {
  name: string;
  file: PersonaFile;
  content: string;
  title: string;
}

// Per-tab editor for IDENTITY.md / EXPERTISE.md / SOUL.md / USER.md inside an
// agent bundle. Mirrors the UX of `UserMdEditor`: dirty detection, Save
// button disabled until edited, error display below. On save, the underlying
// hook invalidates the agent detail query so the parent re-renders with the
// freshly-written content (and `content` prop arrives as the new baseline).
//
// Re-keyed in `AgentEditor.tsx` on the upstream `content` so navigating
// between tabs (or refetching after save) resets local draft state — a
// stale draft surviving a server-side change would silently overwrite it.
export function AgentPersonaEditor({ name, file, content, title }: Props) {
  const [draft, setDraft] = useState(content);
  const save = useSavePersona(name, file);
  const dirty = draft !== content;
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // {title}
      </div>
      <textarea
        className="w-full h-96 bg-black border border-matrix-line p-2 font-mono text-sm text-matrix-body"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`${title} content`}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="font-mono text-[10px] text-matrix-green-muted">
          {dirty ? "// unsaved changes" : "// saved"}
        </span>
        <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {save.isError && (
        <p className="font-mono text-[10px] text-matrix-amber mt-1">
          // error: {(save.error as Error).message}
        </p>
      )}
    </Card>
  );
}
