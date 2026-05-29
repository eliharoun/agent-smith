import type { RefreshManifestRead } from "gui-shared";
import { apiFetch } from "./client";

export const refreshManifestApi = {
  get: (name: string) =>
    apiFetch<RefreshManifestRead>(`/api/agents/${encodeURIComponent(name)}/refresh-manifest`),
};
