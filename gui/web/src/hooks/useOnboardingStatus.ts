import { useQuery } from "@tanstack/react-query";
import { onboardingApi } from "@/api/onboarding";
export function useOnboardingStatus() {
  return useQuery({ queryKey: ["onboarding"], queryFn: onboardingApi.get });
}
