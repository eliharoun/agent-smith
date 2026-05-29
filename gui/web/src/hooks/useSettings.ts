import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuiStatePatch } from "gui-shared";
import { settingsApi } from "@/api/settings";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: GuiStatePatch) => settingsApi.patch(patch),
    onSuccess: (next) => qc.setQueryData(["settings"], next),
  });
}
