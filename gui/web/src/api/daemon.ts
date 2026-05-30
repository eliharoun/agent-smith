import type { DaemonStatus, SmithEnv } from "gui-shared";
import { apiFetch } from "./client";

export const daemonApi = {
  status: () => apiFetch<DaemonStatus>("/api/daemon/status"),
  getEnv: () => apiFetch<SmithEnv>("/api/daemon/env"),
  putEnv: (env: SmithEnv) =>
    apiFetch<SmithEnv>("/api/daemon/env", {
      method: "PUT",
      body: JSON.stringify(env),
    }),
};
