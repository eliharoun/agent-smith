import type {
  AgentConfigPatch,
  AgentDetail,
  AgentSummary,
  InstalledStatus,
  PersonaFile,
} from "gui-shared";
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
  saveConfig: (name: string, patch: AgentConfigPatch) =>
    apiFetch<{ ok: true }>(`/api/agents/${encodeURIComponent(name)}/config`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  applyMcpWiring: (
    name: string,
    body: { enable: boolean; platforms: Array<"opencode" | "claude-code" | "codex" | "kiro"> },
  ) =>
    apiFetch<{
      results: Array<{ platform: string; ok: boolean; error?: string }>;
      platforms: Array<{ platform: string; hasEntry: boolean; cliInstalled: boolean }>;
    }>(`/api/agents/${encodeURIComponent(name)}/mcp-wiring`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
