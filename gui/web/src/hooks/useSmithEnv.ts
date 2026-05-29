import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SmithEnv } from "gui-shared";
import { daemonApi } from "@/api/daemon";

export const smithEnvKey = ["daemon", "env"] as const;

export function useSmithEnv() {
  return useQuery({ queryKey: smithEnvKey, queryFn: daemonApi.getEnv });
}

export function usePutSmithEnv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (env: SmithEnv) => daemonApi.putEnv(env),
    onSuccess: (next) => {
      qc.setQueryData(smithEnvKey, next);
    },
  });
}
