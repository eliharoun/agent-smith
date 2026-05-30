import { useQuery } from "@tanstack/react-query";
import { refreshManifestApi } from "@/api/refresh-manifest";
import { agentsKey } from "./useAgents";

export function useRefreshManifest(name: string) {
  return useQuery({
    queryKey: [...agentsKey, name, "refresh-manifest"],
    queryFn: () => refreshManifestApi.get(name),
    enabled: name.length > 0,
  });
}
