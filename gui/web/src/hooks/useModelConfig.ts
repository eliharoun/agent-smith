import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PutModelConfigBody } from "gui-shared";
import { modelConfigApi } from "@/api/model-config";

export const modelConfigKey = ["model-config"] as const;

export function useModelConfig() {
  return useQuery({ queryKey: modelConfigKey, queryFn: modelConfigApi.get });
}

export function useUpdateModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PutModelConfigBody) => modelConfigApi.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: modelConfigKey });
    },
  });
}
