import { useAgents } from "@/hooks/useAgents";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useStatus } from "@/hooks/useStatus";
import { daemonStateToLampStatus, type LampStatus } from "@/lib/daemon-state-color";

export function useStatStripData() {
  const agents = useAgents();
  const status = useStatus();
  const daemon = useDaemonStatus();
  const daemonLamp: LampStatus = daemonStateToLampStatus(daemon.data?.state);
  return {
    agentCount: agents.data?.length ?? 0,
    daemonLamp,
    daemonState: daemon.data?.state,
    smithVersion: status.data?.smithVersion ?? "—",
    loading: agents.isLoading || status.isLoading || daemon.isLoading,
  };
}
