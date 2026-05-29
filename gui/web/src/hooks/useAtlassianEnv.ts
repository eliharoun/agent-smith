import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AtlassianEnvUpdate } from "gui-shared";
import { atlassianApi } from "@/api/atlassian";

export const atlassianEnvKey = ["atlassian-env"] as const;

export function useAtlassianEnv() {
  return useQuery({ queryKey: atlassianEnvKey, queryFn: atlassianApi.get });
}

export function useUpdateAtlassianEnv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AtlassianEnvUpdate) => atlassianApi.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlassianEnvKey });
    },
  });
}
