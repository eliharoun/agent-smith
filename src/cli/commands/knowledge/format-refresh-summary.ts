/**
 * Pure formatters for the refresh-summary line shown by `smith knowledge list`.
 *
 * Functions in this module:
 *   - never do I/O
 *   - never emit color codes (caller picks pc.dim vs pc.red based on `failed`)
 *   - never throw on well-typed input
 *
 * Caller resolves `cache` via readRefreshCache(); pass `undefined` for sources
 * with no entry. Caller injects `now` for deterministic age math in tests.
 */

import type { RefreshCacheEntry } from "../../../core/knowledge/refresh-cache";
import { parseRefresh } from "../../../core/knowledge/refresh-spec";
import type { RefreshSpec } from "../../../core/knowledge/types";

/**
 * Compact human age. Floors to the largest unit ≤ the duration:
 *   <1m: Ns,  <1h: Nm,  <1d: Nh,  <1w: Nd,  else: Nw
 * Negative durations clamp to "0s". Matches the daemon log scale.
 */
export function formatAge(ms: number): string {
  const clamped = ms < 0 ? 0 : ms;
  if (clamped < 60_000) return `${Math.floor(clamped / 1000)}s`;
  if (clamped < 3_600_000) return `${Math.floor(clamped / 60_000)}m`;
  if (clamped < 86_400_000) return `${Math.floor(clamped / 3_600_000)}h`;
  if (clamped < 604_800_000) return `${Math.floor(clamped / 86_400_000)}d`;
  return `${Math.floor(clamped / 604_800_000)}w`;
}

const MAX_ERR_CHARS = 80;

function truncateErr(err: string): string {
  if (err.length <= MAX_ERR_CHARS) return err;
  return `${err.slice(0, MAX_ERR_CHARS - 1)}…`;
}

/**
 * Build the one-line refresh-status summary for a source. Pure; no I/O.
 *
 * `failed` tells the caller whether to render in pc.red (true) or pc.dim
 * (false). The line itself contains no color codes.
 *
 * `now` is ms-since-epoch; inject via Date.now() in production, fixed value
 * in tests.
 */
export function formatRefreshSummary(args: {
  refresh: RefreshSpec | undefined;
  cache: RefreshCacheEntry | undefined;
  now: number;
}): { line: string; failed: boolean } {
  const { refresh, cache, now } = args;

  let normalized: ReturnType<typeof parseRefresh>;
  try {
    normalized = parseRefresh(refresh);
  } catch {
    return { line: "refresh: <invalid>", failed: false };
  }

  const mode = normalized.mode;

  if (mode === "install") {
    return { line: "refresh: install only (no auto-refresh)", failed: false };
  }

  // Compose the leading "refresh: <descriptor>" segment per mode.
  let head: string;
  if (mode === "ttl") {
    const ttlStr = normalized.ttl ?? "(no interval)";
    head = `refresh: ttl ${ttlStr}`;
  } else if (mode === "session") {
    head = "refresh: session";
  } else {
    // mode === "always"
    head = "refresh: install + session";
  }

  if (cache === undefined) {
    return { line: `${head}, never refreshed`, failed: false };
  }

  if (cache.last_error !== null) {
    // Failure: report against last_attempt_at so users see the failure age.
    const attemptMs = now - Date.parse(cache.last_attempt_at);
    return {
      line: `${head}, last ${formatAge(attemptMs)} ago, FAILED: ${truncateErr(cache.last_error)}`,
      failed: true,
    };
  }

  // Success.
  const okMs = now - Date.parse(cache.last_refreshed_at);
  const okAge = formatAge(okMs);

  if (mode === "ttl" && normalized.ttlMs !== undefined) {
    const remaining = normalized.ttlMs - okMs;
    if (remaining > 0) {
      return {
        line: `${head}, last ${okAge} ago, ok (next in ${formatAge(remaining)})`,
        failed: false,
      };
    }
    return { line: `${head}, last ${okAge} ago, ok (due now)`, failed: false };
  }

  // session or always: no due-time math.
  return { line: `${head}, last ${okAge} ago, ok`, failed: false };
}
