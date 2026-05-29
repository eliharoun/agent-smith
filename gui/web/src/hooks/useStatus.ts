import { useQuery } from "@tanstack/react-query";
import { statusApi } from "@/api/status";
export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: statusApi.get, refetchInterval: 30_000 });
}
