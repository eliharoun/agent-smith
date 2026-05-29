import { useQuery } from "@tanstack/react-query";
import { daemonApi } from "@/api/daemon";

export const daemonStatusKey = ["daemon", "status"] as const;

export function useDaemonStatus() {
  return useQuery({
    queryKey: daemonStatusKey,
    queryFn: daemonApi.status,
    refetchInterval: 2_000, // poll while panel mounted
  });
}
