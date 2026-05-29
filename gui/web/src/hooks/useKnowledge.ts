import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { knowledgeApi, type PutConsentBody } from "@/api/knowledge";

export const knowledgeKey = (agent: string) => ["knowledge", agent] as const;

export function useKnowledge(agent: string) {
  return useQuery({
    queryKey: knowledgeKey(agent),
    queryFn: () => knowledgeApi.get(agent),
    enabled: agent.length > 0,
  });
}

/**
 * Grants refresh consent for an agent. Used by the RefreshConsentBanner
 * "authorize and refresh" flow — clicking the button now persists the
 * consent manifest synchronously instead of relying on a CLI prompt
 * (which never fires under spawn-from-GUI). On success the
 * ['knowledge', agent] query is invalidated so the banner disappears.
 */
export function useGrantRefreshConsent(agent: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutConsentBody) => knowledgeApi.putConsent(agent, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKey(agent) });
    },
  });
}
