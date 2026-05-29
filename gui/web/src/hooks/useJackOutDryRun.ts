import { useQuery } from "@tanstack/react-query";
import { jackOutApi } from "@/api/jackOut";

export const jackOutDryRunKey = ["jack-out", "dry-run"] as const;

export function useJackOutDryRun() {
  return useQuery({
    queryKey: jackOutDryRunKey,
    queryFn: jackOutApi.dryRun,
    staleTime: 60_000,
  });
}
