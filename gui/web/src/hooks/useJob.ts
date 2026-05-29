import { useQuery } from "@tanstack/react-query";
import { jobsApi } from "@/api/jobs";
export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => jobsApi.get(id!),
    enabled: Boolean(id),
    refetchInterval: 1_000,
  });
}
