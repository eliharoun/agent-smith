import { useQuery } from "@tanstack/react-query";
import type { McpServerAndToolsView } from "gui-shared";
import { apiFetch } from "@/api/client";

/**
 * Fetches the union of bundle + AI-client MCP servers (plus each server's
 * URL-shaped tools) for the Add Knowledge Source modal's routing dropdown.
 *
 * The query is gated on `enabled` so the modal only spawns server processes
 * when the user has actually selected `type: url`. Disabling the query
 * keeps the lookup off until the user can act on it.
 *
 * The response talks to the per-request pool on the server, so each call
 * spawns and shuts down MCP servers exactly once. We use a generous
 * staleTime (5 min) since the candidate set is unlikely to shift mid-session.
 */
export function useMcpServersAndTools(agent: string, enabled: boolean) {
  return useQuery<McpServerAndToolsView>({
    queryKey: ["mcp-servers-and-tools", agent],
    queryFn: () =>
      apiFetch<McpServerAndToolsView>(
        `/api/agents/${encodeURIComponent(agent)}/mcp-servers-and-tools`,
      ),
    enabled: enabled && agent.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
