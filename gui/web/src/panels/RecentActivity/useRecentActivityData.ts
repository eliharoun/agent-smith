import { useQueries } from "@tanstack/react-query";
import { jobsApi } from "@/api/jobs";
import { useActiveJobsStore } from "@/store/active-jobs";

export function useRecentActivityData() {
  const ids = useActiveJobsStore((s) => s.active).slice(0, 5);
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["job", id],
      queryFn: () => jobsApi.get(id),
      refetchInterval: 2000,
    })),
  });
  return queries.map((q) => q.data).filter(Boolean);
}
