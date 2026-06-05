import { useQuery } from "@tanstack/react-query";
import type { Platform } from "gui-shared";
import { apiFetch } from "@/api/client";
import { agentsKey } from "./useAgents";

/**
 * Cache key for the drift-check query. Lives under the agent's namespace so
 * `qc.invalidateQueries({ queryKey: ["agents", name] })` (or any prefix) also
 * invalidates the drift state — matches the pattern used by `useAgent` and
 * `useInstalledStatus`.
 */
export function driftCheckKey(agent: string) {
  return [...agentsKey, agent, "drift-check"] as const;
}

interface DriftCheckResponse {
  drifted: Platform[];
}

/**
 * Wraps `GET /api/agents/:name/drift-check` via tanstack-query.
 *
 *  - 30s `staleTime` so a tab idling on the agent page doesn't hammer the
 *    endpoint (each call dry-renders the bundle which is non-trivial work).
 *  - Refetches on window-focus so the user gets fresh state when they tab
 *    back from a CLI session that mutated install state.
 */
export function useDriftCheck(agent: string): {
  drifted: Platform[] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const q = useQuery<DriftCheckResponse, Error>({
    queryKey: driftCheckKey(agent),
    queryFn: () =>
      apiFetch<DriftCheckResponse>(
        `/api/agents/${encodeURIComponent(agent)}/drift-check`,
      ),
    enabled: agent.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    drifted: q.data?.drifted,
    isLoading: q.isLoading,
    error: q.error ?? null,
  };
}
