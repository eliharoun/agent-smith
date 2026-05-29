import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useStatus } from "@/hooks/useStatus";
import { daemonStateToLampStatus } from "@/lib/daemon-state-color";
import { useModeStore } from "@/store/mode";
import { Breadcrumbs } from "./Breadcrumbs";
import { Lamp } from "./Lamp";
import { Toggle } from "./Toggle";

export function TopBar() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const status = useStatus();
  const daemon = useDaemonStatus();
  return (
    <header className="border-b border-matrix-line bg-black/80 backdrop-blur sticky top-0 z-30 px-4 py-2 flex items-center justify-between">
      <Breadcrumbs />
      <div className="flex items-center gap-4">
        <Lamp status={daemonStateToLampStatus(daemon.data?.state)} label="daemon" />
        <span className="font-mono text-[10px] text-matrix-green-muted">
          v{status.data?.smithVersion ?? "—"}
        </span>
        <Toggle
          checked={mode === "expert"}
          onChange={(v) => setMode(v ? "expert" : "guided")}
          label={mode === "expert" ? "expert" : "guided"}
        />
      </div>
    </header>
  );
}
