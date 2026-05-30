import type { JobRequest } from "gui-shared";
import { apiFetch, getToken } from "./client";

export interface JobStartResponse {
  jobId: string;
  preview: string;
}
export interface JobRecordView {
  id: string;
  command: string;
  argv: string[];
  preview: string;
  status: "pending" | "running" | "succeeded" | "failed" | "evicted";
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
}

export const jobsApi = {
  start: (req: JobRequest) =>
    apiFetch<JobStartResponse>("/api/jobs", { method: "POST", body: JSON.stringify(req) }),
  get: (id: string) => apiFetch<JobRecordView>(`/api/jobs/${id}`),
  respond: (id: string, answer: string) =>
    apiFetch<{ ok: true }>(`/api/jobs/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    }),
  streamUrl: (id: string) => {
    const token = getToken() ?? "";
    return `/api/jobs/${id}/stream?token=${encodeURIComponent(token)}`;
  },
};
