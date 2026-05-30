import { Card } from "@/ui/Card";

interface Props {
  body: string;
}

/**
 * Read-only markdown body. We deliberately do NOT syntax-highlight or render
 * markdown — the editor convention here is "see exactly what's on disk".
 */
export function SkillBodyEditor({ body }: Props) {
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-amber mb-2">
        // skills are edited on disk — open in your editor to modify
      </div>
      <pre className="font-mono text-xs text-matrix-body whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
        {body || "// (empty body)"}
      </pre>
    </Card>
  );
}
