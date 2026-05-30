import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PersonaFile } from "gui-shared";
import { agentsApi } from "@/api/agents";

export const agentsKey = ["agents"] as const;

export function useAgents() {
  return useQuery({ queryKey: agentsKey, queryFn: agentsApi.list });
}

export function useAgent(name: string) {
  return useQuery({
    queryKey: [...agentsKey, name],
    queryFn: () => agentsApi.get(name),
    enabled: name.length > 0,
  });
}

export function useInstalledStatus(name: string) {
  return useQuery({
    queryKey: [...agentsKey, name, "installed"],
    queryFn: () => agentsApi.installedStatus(name),
    enabled: name.length > 0,
  });
}

// Per-tab persona save. On success invalidates the agent detail query so any
// open editor refetches the freshly-written content (and any computed views
// off it). Does NOT trigger a re-install — Task 6 explicitly leaves that to
// the user; an inline notice in `AgentEditor.tsx` warns when the agent is
// installed somewhere.
export function useSavePersona(name: string, file: PersonaFile) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => agentsApi.savePersona(name, file, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...agentsKey, name] });
    },
  });
}
