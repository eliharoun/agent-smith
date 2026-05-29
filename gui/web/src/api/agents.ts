import type { AgentDetail, AgentSummary, InstalledStatus, PersonaFile } from "gui-shared";
import { apiFetch } from "./client";

export const agentsApi = {
  list: () => apiFetch<AgentSummary[]>("/api/agents"),
  get: (name: string) => apiFetch<AgentDetail>(`/api/agents/${encodeURIComponent(name)}`),
  installedStatus: (name: string) =>
    apiFetch<InstalledStatus>(`/api/agents/${encodeURIComponent(name)}/installed-status`),
  savePersona: (name: string, file: PersonaFile, content: string) =>
    apiFetch<{ ok: true }>(
      `/api/agents/${encodeURIComponent(name)}/persona/${encodeURIComponent(file)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ),
};
