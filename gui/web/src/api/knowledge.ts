import type {
  AgentKnowledgeView,
  ParsedKnowledgeUrl,
  RefreshCacheEntry,
  RefreshConsentManifest,
  RefreshSummary,
} from "gui-shared";
import { apiFetch } from "./client";

export interface RefreshHistoryResponse {
  agent: string;
  consent?: RefreshConsentManifest["refresh_consent"];
  entries: (RefreshCacheEntry & { sourceId: string })[];
}

export interface RefreshSummariesResponse {
  summaries: RefreshSummary[];
}

export interface PutConsentBody {
  platforms: ("opencode" | "claude-code" | "codex" | "kiro")[];
  sources: string[];
}

export const knowledgeApi = {
  get: (agent: string) =>
    apiFetch<AgentKnowledgeView>(`/api/knowledge/${encodeURIComponent(agent)}`),
  getRefreshHistory: (agent: string) =>
    apiFetch<RefreshHistoryResponse>(`/api/knowledge/${encodeURIComponent(agent)}/refresh-history`),
  getRefreshSummaries: () => apiFetch<RefreshSummariesResponse>("/api/knowledge/refresh-summary"),
  parseUrl: (url: string) =>
    apiFetch<ParsedKnowledgeUrl>("/api/knowledge/parse-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  putConsent: (agent: string, body: PutConsentBody) =>
    apiFetch<{ ok: true }>(`/api/knowledge/${encodeURIComponent(agent)}/consent`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
