import { apiFetch } from "./client";
export interface SystemStatus {
  agentCount: number;
  smithVersion: string;
}
export const statusApi = { get: () => apiFetch<SystemStatus>("/api/status") };
