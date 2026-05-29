import type { OnboardingStatus } from "gui-shared";
import { apiFetch } from "./client";
export const onboardingApi = {
  get: () => apiFetch<OnboardingStatus>("/api/onboarding-status"),
};
