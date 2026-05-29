import type { UpdatePreview } from "gui-shared";
import { apiFetch } from "./client";

export const updateApi = {
  preview: () => apiFetch<UpdatePreview>("/api/update/preview"),
};
