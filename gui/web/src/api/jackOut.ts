import type { JackOutDryRun } from "gui-shared";
import { apiFetch } from "./client";

export const jackOutApi = {
  dryRun: () => apiFetch<JackOutDryRun>("/api/jack-out/dry-run"),
};
