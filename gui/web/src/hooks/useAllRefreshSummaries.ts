import { useQuery } from "@tanstack/react-query";
import { knowledgeApi } from "@/api/knowledge";

export const allRefreshSummariesKey = ["knowledge", "refresh-summary"] as const;

export function useAllRefreshSummaries() {
  return useQuery({
    queryKey: allRefreshSummariesKey,
    queryFn: () => knowledgeApi.getRefreshSummaries(),
  });
}
