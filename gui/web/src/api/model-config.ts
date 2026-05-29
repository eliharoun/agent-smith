import type { ModelConfig, PutModelConfigBody } from "gui-shared";
import { apiFetch } from "./client";

export const modelConfigApi = {
  get: () => apiFetch<ModelConfig>("/api/model-config"),
  update: (payload: PutModelConfigBody) =>
    apiFetch<ModelConfig>("/api/model-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
};
