import { apiFetch } from "./client";

export const userMdApi = {
  get: () => apiFetch<{ content: string }>("/api/user-md"),
  put: (content: string) =>
    apiFetch<{ ok: true }>("/api/user-md", {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
};
