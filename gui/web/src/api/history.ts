import type { JobHistoryEntry, JobHistorySearchHit } from "gui-shared";
import { ApiError, apiFetch, getToken } from "./client";

export interface JobHistoryListOptions {
  limit?: number;
  offset?: number;
}

function historyQuery(opts: JobHistoryListOptions): string {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * GET /api/history/:id/output returns text/plain (not JSON), so it can't go
 * through the generic apiFetch<T> helper. Handle it directly here while still
 * threading the Bearer token and mapping non-OK responses to ApiError.
 */
async function fetchJobOutputText(id: string): Promise<string | null> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`/api/history/${encodeURIComponent(id)}/output`, {
    headers,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText, code: "UNKNOWN" }))) as {
      error: string;
      code: string;
    };
    throw new ApiError(res.status, body.code, body.error);
  }
  return await res.text();
}

export const historyApi = {
  list: (opts: JobHistoryListOptions = {}) =>
    apiFetch<JobHistoryEntry[]>(`/api/history${historyQuery(opts)}`),
  output: (id: string) => fetchJobOutputText(id),
  search: (q: string, limit = 20) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return apiFetch<JobHistorySearchHit[]>(`/api/history/search?${qs}`);
  },
};
