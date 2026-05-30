import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSettings } from "@/hooks/useSettings";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const q = useOnboardingStatus();
  const settings = useSettings();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (!q.data) return;
    const needsOnboarding = q.data.state === "FIRST_RUN" || q.data.state === "NEEDS_USER_MD";
    const replayingTour = settings.data?.tourCompleted === false;
    if ((needsOnboarding || replayingTour) && loc.pathname !== "/onboarding") {
      nav("/onboarding", { replace: true });
    }
  }, [q.data, settings.data, loc.pathname, nav]);
  if (q.isLoading) return null;
  return <>{children}</>;
}
