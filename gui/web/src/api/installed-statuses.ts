import type { InstalledStatusBulk } from "gui-shared";
import { apiFetch } from "./client";

export const installedStatusesApi = {
  list: () => apiFetch<InstalledStatusBulk>("/api/agents/installed-statuses"),
};
