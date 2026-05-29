import type { GuiState, GuiStatePatch } from "gui-shared";
import { apiFetch } from "./client";
export const settingsApi = {
  get: () => apiFetch<GuiState>("/api/settings"),
  patch: (patch: GuiStatePatch) =>
    apiFetch<GuiState>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
};
