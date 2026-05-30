import { TerminalLog } from "@/ui/TerminalLog";
import { useTerminalStripData } from "./useTerminalStripData";

export function TerminalStrip() {
  const { jobId, lines } = useTerminalStripData();
  if (!jobId) return null;
  return (
    <div className="border-t border-matrix-line bg-black/80 p-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-matrix-green-muted mb-1">
        // terminal · job {jobId.slice(0, 8)}
      </div>
      <TerminalLog lines={lines} height={140} />
    </div>
  );
}
