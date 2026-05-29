import type { AgentSummary, Platform } from "gui-shared";
import { useMemo } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useInstalledStatuses } from "@/hooks/useInstalledStatuses";

export type AgentListRow = AgentSummary & {
  installed: Partial<Record<Platform, boolean>>;
};

export interface AgentCatalogGroup {
  catalogLabel: string;
  rows: AgentListRow[];
}

export function useAgentListData() {
  const agentsQ = useAgents();
  const statusesQ = useInstalledStatuses();

  const agents = useMemo<AgentListRow[]>(() => {
    const statuses = statusesQ.data ?? {};
    return (agentsQ.data ?? []).map((a) => ({
      ...a,
      installed: statuses[a.name]?.installed ?? {},
    }));
  }, [agentsQ.data, statusesQ.data]);

  const byCatalog: AgentCatalogGroup[] = useMemo(() => {
    const map = new Map<string, AgentListRow[]>();
    for (const a of agents) {
      const arr = map.get(a.catalog) ?? [];
      arr.push(a);
      map.set(a.catalog, arr);
    }
    return Array.from(map.entries())
      .map(([catalogLabel, rows]) => ({ catalogLabel, rows }))
      .sort((a, b) => a.catalogLabel.localeCompare(b.catalogLabel));
  }, [agents]);

  return { agents, byCatalog, loading: agentsQ.isLoading, error: agentsQ.error };
}
