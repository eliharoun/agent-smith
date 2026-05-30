import { Card } from "@/ui/Card";
import { Lamp } from "@/ui/Lamp";
import { useStatStripData } from "./useStatStripData";

const labels = {
  on: "active",
  warn: "stuck",
  off: "idle",
  error: "error",
} as const;

export function StatStrip() {
  const { agentCount, daemonLamp, smithVersion } = useStatStripData();
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // agents
        </div>
        <div className="font-mono text-3xl text-matrix-green mt-1">{agentCount}</div>
      </Card>
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // daemon
        </div>
        <div className="mt-2">
          <Lamp status={daemonLamp} label={labels[daemonLamp]} />
        </div>
      </Card>
      <Card>
        <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted">
          // smith
        </div>
        <div className="font-mono text-xl text-matrix-body mt-1">v{smithVersion}</div>
      </Card>
    </div>
  );
}
