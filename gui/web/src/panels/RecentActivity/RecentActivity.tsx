import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { useRecentActivityData } from "./useRecentActivityData";

export function RecentActivity() {
  const jobs = useRecentActivityData();
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // recent activity
      </div>
      {jobs.length === 0 && <div className="text-matrix-green-muted text-sm">no jobs yet</div>}
      <ul className="space-y-1">
        {jobs.map((j) => (
          <li key={j!.id} className="flex items-center gap-2 font-mono text-xs">
            <Chip
              tone={j!.status === "succeeded" ? "green" : j!.status === "failed" ? "red" : "amber"}
            >
              {j!.status}
            </Chip>
            <span className="text-matrix-body truncate">{j!.preview}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
