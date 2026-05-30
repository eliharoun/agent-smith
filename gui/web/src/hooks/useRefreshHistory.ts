import { useQuery } from "@tanstack/react-query";
import { knowledgeApi } from "@/api/knowledge";

export const refreshHistoryKey = (agent: string) =>
  ["knowledge", agent, "refresh-history"] as const;

export function useRefreshHistory(agent: string) {
  return useQuery({
    queryKey: refreshHistoryKey(agent),
    queryFn: () => knowledgeApi.getRefreshHistory(agent),
    enabled: agent.length > 0,
  });
}
