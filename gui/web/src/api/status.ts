import { apiFetch } from "./client";
export interface SystemStatus {
  agentCount: number;
  smithVersion: string;
  /** True when the GUI server runs from a maintainer's clone (drives the
   *  clone-mode banner). Optional for backward-compat with older servers. */
  cloneMode?: boolean;
}
export const statusApi = { get: () => apiFetch<SystemStatus>("/api/status") };
