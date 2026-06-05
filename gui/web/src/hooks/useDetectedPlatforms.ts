import { useQuery } from "@tanstack/react-query";
import { platformsApi } from "@/api/platforms";

export const detectedPlatformsKey = ["platforms", "detected"] as const;

/**
 * Returns the set of AI coding platform CLIs currently on PATH. Used by
 * the consent banner and any other UI that should filter actions to
 * platforms the user has installed.
 *
 * Cached for the lifetime of the React-query client; staleTime is short
 * so installing a new CLI mid-session is picked up reasonably quickly.
 */
export function useDetectedPlatforms() {
  return useQuery({
    queryKey: detectedPlatformsKey,
    queryFn: platformsApi.detected,
    staleTime: 30_000,
  });
}
