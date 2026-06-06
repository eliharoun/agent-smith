import type { DetectedPlatformsResponse } from "gui-shared";
import type { PendingOp } from "../../../../src/io/pending-ops";
import { apiFetch } from "./client";

export const platformsApi = {
  detected: () => apiFetch<DetectedPlatformsResponse>("/api/platforms/detected"),
};

export const pendingOpsApi = {
  list: () => apiFetch<{ ops: PendingOp[] }>("/api/pending-ops"),
};
