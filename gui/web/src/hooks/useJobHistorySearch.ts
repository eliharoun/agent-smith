import { useQuery } from "@tanstack/react-query";
import { historyApi } from "@/api/history";

export const jobHistorySearchKey = (q: string) => ["history", "search", q] as const;

export function useJobHistorySearch(q: string) {
  return useQuery({
    queryKey: jobHistorySearchKey(q),
    queryFn: () => historyApi.search(q),
    enabled: q.length >= 2,
  });
}
