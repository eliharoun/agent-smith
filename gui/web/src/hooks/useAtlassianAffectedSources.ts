import { useQuery } from "@tanstack/react-query";
import { atlassianApi } from "@/api/atlassian";

export const atlassianAffectedSourcesKey = ["atlassian-env", "affected-sources"] as const;

export function useAtlassianAffectedSources() {
  return useQuery({
    queryKey: atlassianAffectedSourcesKey,
    queryFn: () => atlassianApi.affectedSources(),
  });
}
