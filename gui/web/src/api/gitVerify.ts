import type { GitVerifyRequest, GitVerifyResult } from "gui-shared";
import { apiFetch } from "./client";

export const gitVerifyApi = {
  verify: (payload: GitVerifyRequest) =>
    apiFetch<GitVerifyResult>("/api/git/verify-remote", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
