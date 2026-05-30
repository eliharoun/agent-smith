import { useQuery } from "@tanstack/react-query";
import { historyApi, type JobHistoryListOptions } from "@/api/history";

export const jobHistoryKey = (opts: JobHistoryListOptions) => ["history", "list", opts] as const;

export const jobOutputKey = (id: string | null) => ["history", "output", id] as const;

export function useJobHistory(opts: JobHistoryListOptions = {}) {
  return useQuery({
    queryKey: jobHistoryKey(opts),
    queryFn: () => historyApi.list(opts),
  });
}

export function useJobOutput(id: string | null) {
  return useQuery({
    queryKey: jobOutputKey(id),
    queryFn: () => historyApi.output(id!),
    enabled: id !== null,
  });
}
