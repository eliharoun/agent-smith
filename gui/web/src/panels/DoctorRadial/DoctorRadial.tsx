import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Gauge } from "@/ui/Gauge";
import { useDoctorRadialData } from "./useDoctorRadialData";

export function DoctorRadial() {
  const { score, label, loading, refusal, error, refetch } = useDoctorRadialData();
  if (error) {
    return (
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // health
        </div>
        <div className="font-mono text-sm text-matrix-red mb-2">doctor failed</div>
        <div className="font-mono text-xs text-matrix-green-muted mb-3">{error.message}</div>
        <Button variant="ghost" onClick={() => refetch()}>
          Re-run
        </Button>
      </Card>
    );
  }
  if (refusal) {
    return (
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
          // health
        </div>
        <div className="font-mono text-sm text-matrix-red">
          no platform detected — install OpenCode/Claude Code/Codex
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-2">
        // health
      </div>
      <div className="flex items-center gap-4">
        <Gauge value={score} label={loading ? "scanning" : label} />
      </div>
    </Card>
  );
}
