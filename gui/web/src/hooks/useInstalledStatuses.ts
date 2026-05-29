import { useQuery } from "@tanstack/react-query";
import { installedStatusesApi } from "@/api/installed-statuses";
import { agentsKey } from "./useAgents";

export const installedStatusesKey = [...agentsKey, "installed-statuses"] as const;

export function useInstalledStatuses() {
  return useQuery({
    queryKey: installedStatusesKey,
    queryFn: installedStatusesApi.list,
  });
}
