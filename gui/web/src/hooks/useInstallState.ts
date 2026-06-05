import { useQuery } from "@tanstack/react-query";
import type { Platform } from "gui-shared";
import { apiFetch } from "@/api/client";
import { agentsKey } from "./useAgents";

export interface InstallStateEntry {
  platform: Platform;
  path: string;
  contentHash: string;
  installedAt: string;
  kind: "main" | "sidecar";
}

interface InstallStateResponse {
  entries: InstallStateEntry[];
}

/**
 * Cache key for the per-agent install-state query. Nested under
 * `agentsKey` so any agent-scoped invalidation also drops the install state.
 */
export function installStateKey(agent: string) {
  return [...agentsKey, agent, "install-state"] as const;
}

/**
 * Wraps `GET /api/agents/:name/install-state` — the manifest entries the GUI
 * needs to know which platforms have an active main install (and thus which
 * platforms a Re-install button should target).
 */
export function useInstallState(agent: string): {
  entries: InstallStateEntry[] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const q = useQuery<InstallStateResponse, Error>({
    queryKey: installStateKey(agent),
    queryFn: () =>
      apiFetch<InstallStateResponse>(
        `/api/agents/${encodeURIComponent(agent)}/install-state`,
      ),
    enabled: agent.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    entries: q.data?.entries,
    isLoading: q.isLoading,
    error: q.error ?? null,
  };
}
