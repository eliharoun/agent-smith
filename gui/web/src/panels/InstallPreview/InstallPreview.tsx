import { Card } from "@/ui/Card";

export function InstallPreview({ summary }: { summary: string[] }) {
  if (summary.length === 0) return null;
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // will apply
      </div>
      <ul className="font-mono text-xs text-matrix-body space-y-0.5">
        {summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </Card>
  );
}
