import type { DetectedPlatformsResponse } from "gui-shared";
import { apiFetch } from "./client";

export const platformsApi = {
  detected: () => apiFetch<DetectedPlatformsResponse>("/api/platforms/detected"),
};
