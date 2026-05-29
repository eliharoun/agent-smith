import { useQuery } from "@tanstack/react-query";
import { updateApi } from "@/api/update";

export const updatePreviewKey = ["update", "preview"] as const;

export function useUpdatePreview() {
  return useQuery({
    queryKey: updatePreviewKey,
    queryFn: updateApi.preview,
    staleTime: 30_000, // dry-run is slow; cache aggressively
  });
}
