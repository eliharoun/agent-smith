import { useEffect, useState } from "react";
import { useSaveUserMd, useUserMd } from "@/hooks/useUserMd";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";

export function UserMdEditor() {
  const q = useUserMd();
  const save = useSaveUserMd();
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (q.data && draft === null) setDraft(q.data.content);
  }, [q.data, draft]);
  const dirty = draft !== null && q.data && draft !== q.data.content;
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // USER.md
      </div>
      {q.isLoading ? (
        <div className="font-mono text-sm text-matrix-body">loading…</div>
      ) : (
        <>
          <textarea
            className="w-full h-48 bg-black border border-matrix-line p-2 font-mono text-sm text-matrix-body"
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="USER.md content"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono text-[10px] text-matrix-green-muted">
              {dirty ? "// unsaved changes" : "// saved"}
            </span>
            <Button
              onClick={() => {
                if (draft !== null) save.mutate(draft);
              }}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {save.isError && (
            <p className="font-mono text-[10px] text-matrix-amber mt-1">
              // error: {(save.error as Error).message}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
