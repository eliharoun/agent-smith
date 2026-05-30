import type { KnowledgeSourceType, NormalizedRefresh, RefreshMode, RefreshSpec } from "./types";

export const DEFAULT_REFRESH: NormalizedRefresh = { mode: "install" };
/** Per-source fetch budget in seconds, applied by the refresh runner when
 *  NormalizedRefresh.timeout is undefined. parseRefresh does NOT inject this. */
export const DEFAULT_TIMEOUT_SECONDS = 5;

/** Static source types: their content lives on local disk and never changes
 *  between install and session start, so we reject non-install modes for them. */
const STATIC_TYPES = new Set<KnowledgeSourceType>(["file", "dir", "glob"]);

/** Parse a TTL string like "30m" / "2h" / "1d" / "1w" into milliseconds.
 *  Accepts only the canonical `<positive-integer><unit>` form where unit is
 *  one of s|m|h|d|w. Throws on anything else; the validator catches user
 *  errors upstream so callers here can rely on the format. */
export function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)([smhdw])$/.exec(ttl);
  if (!match) {
    throw new Error(
      `invalid ttl format: ${JSON.stringify(ttl)} (expected <integer><unit> where unit is s|m|h|d|w)`,
    );
  }
  const n = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60 * 1000
        : unit === "h"
          ? 60 * 60 * 1000
          : unit === "d"
            ? 24 * 60 * 60 * 1000
            : /* "w" */ 7 * 24 * 60 * 60 * 1000;
  return n * multiplier;
}

/** Normalize the user-facing RefreshSpec into the internal NormalizedRefresh form.
 *  - undefined → install (default)
 *  - "never" → install
 *  - "1h"/"1d"/"1w" → { mode: "ttl", ttl: <value>, ttlMs }
 *  - object → passed through; when mode === "ttl" and ttl is set, ttlMs
 *    is computed and attached. When mode === "ttl" but ttl is absent
 *    (validator catches this for user input; defensive here), ttlMs is
 *    left undefined rather than throwing.
 *
 *  Assumes the object form has already passed Zod validation (see schema.ts);
 *  this function is total and trusts its input shape. */
export function parseRefresh(raw: RefreshSpec | undefined): NormalizedRefresh {
  if (raw === undefined) return DEFAULT_REFRESH;
  if (typeof raw === "string") {
    if (raw === "never") return { mode: "install" };
    return { mode: "ttl", ttl: raw, ttlMs: parseTtlToMs(raw) };
  }
  if (raw.mode === "ttl" && raw.ttl !== undefined) {
    return { ...raw, ttlMs: parseTtlToMs(raw.ttl) };
  }
  return raw;
}

/** Whether a refresh mode is allowed for a given source type.
 *  Static types (file/dir/glob) only allow "install" — refreshing local content
 *  is a no-op and we reject it at validation time to surface user error early. */
export function isModeAllowedForType(type: KnowledgeSourceType, mode: RefreshMode): boolean {
  if (STATIC_TYPES.has(type)) return mode === "install";
  return true;
}
