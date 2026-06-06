import { useQuery } from "@tanstack/react-query";
import { platformsApi } from "@/api/platforms";

export const detectedPlatformsKey = ["platforms", "detected"] as const;

/**
 * Returns the set of AI coding platform CLIs currently on PATH. Used by
 * the consent banner and any other UI that should filter actions to
 * platforms the user has installed.
 *
 * Polls every 30 s so that useDetectPlatformCli can fire a toast when the
 * user installs a new platform CLI mid-session.
 */
export function useDetectedPlatforms() {
  return useQuery({
    queryKey: detectedPlatformsKey,
    queryFn: platformsApi.detected,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
