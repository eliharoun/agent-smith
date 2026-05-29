import type { AtlassianEnvStatus, AtlassianEnvUpdate } from "gui-shared";
import { apiFetch } from "./client";

export interface AtlassianAffectedSource {
  agent: string;
  sourceId: string;
  type: "confluence" | "jira";
  label?: string;
}

export interface AtlassianAffectedSourcesResponse {
  sources: AtlassianAffectedSource[];
}

export const atlassianApi = {
  get: () => apiFetch<AtlassianEnvStatus>("/api/atlassian-env"),
  update: (payload: AtlassianEnvUpdate) =>
    apiFetch<AtlassianEnvStatus>("/api/atlassian-env", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  affectedSources: () =>
    apiFetch<AtlassianAffectedSourcesResponse>("/api/atlassian/affected-sources"),
};
