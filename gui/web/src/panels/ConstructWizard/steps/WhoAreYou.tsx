import { useEffect, useRef, useState } from "react";
import { useSaveUserMd, useUserMd } from "@/hooks/useUserMd";
import { Button } from "@/ui/Button";

const TEMPLATE = `# USER

I am <your name>, a <role>. I usually work on <what you usually work on>.
Treat me as a competent collaborator who values terse, direct communication.
`;

export function WhoAreYou({ onNext }: { onNext: () => void }) {
  const userMd = useUserMd();
  const save = useSaveUserMd();
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Seed the textarea once the existing content (or empty) is loaded. One-shot:
  // never re-clobber the user's edits when the query refetches.
  useEffect(() => {
    if (!seededRef.current && userMd.data) {
      seededRef.current = true;
      setContent(userMd.data.content || TEMPLATE);
    }
  }, [userMd.data]);

  const handleSave = async () => {
    setError(null);
    try {
      await save.mutateAsync(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg?.trim() ? `save failed: ${msg}` : "save failed");
      return;
    }
    onNext();
  };

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="font-mono text-matrix-green text-2xl uppercase tracking-widest">
        // who are you
      </h1>
      <p className="font-mono text-xs text-matrix-green-muted">
        Edit your USER.md. Saved to your agent-smith state directory ($XDG_CONFIG_HOME/agent-smith,
        or ~/.config/agent-smith when unset).
      </p>
      <textarea
        aria-label="USER.md"
        className="w-full h-64 bg-black border border-matrix-line p-2 font-mono text-sm text-matrix-body"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {error && <p className="font-mono text-xs text-matrix-amber">// {error}</p>}
      <div className="flex justify-end">
        <Button disabled={save.isPending || userMd.isLoading} onClick={handleSave}>
          {save.isPending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}
