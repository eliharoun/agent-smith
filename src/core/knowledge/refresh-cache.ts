/**
 * Per-source knowledge-refresh cache at
 * `<cacheRoot>/agents/<agent>/sources/<sourceId>.meta.json`.
 *
 * Records the timestamp of the last successful refresh, the timestamp and
 * outcome of the last attempt, and optional conditional-GET headers (etag /
 * last-modified) for url sources. The runner reads this file to decide
 * whether a source is due for refresh (via `cacheAgeMs`) and writes it
 * after each attempt — success or failure (PHASE-5 spec §9.1).
 *
 * Caller (Task 2) is responsible for resolving `cacheRoot` from
 * `~/.cache/agent-smith`; this module is a pure utility that takes the
 * root as a parameter.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { assertWithin } from "../../io/assert-within";

export const RefreshCacheEntrySchema = z.preprocess((input) => {
  // B11.6 migration: legacy entries (pre-v0.24.0) had no schemaVersion
  // field. Inject schemaVersion: 1 in-memory when missing so v0.24.0
  // parses current-shape objects. Migration is lazy — the next write
  // (next refresh tick) persists the new shape.
  if (
    input &&
    typeof input === "object" &&
    !("schemaVersion" in (input as Record<string, unknown>))
  ) {
    return { schemaVersion: 1, ...(input as Record<string, unknown>) };
  }
  return input;
}, z.object({
  schemaVersion: z.literal(1),
  /** ISO8601. Time of the last SUCCESSFUL refresh. */
  last_refreshed_at: z.string().datetime(),
  /** ISO8601. Time of the last refresh attempt (success or failure). */
  last_attempt_at: z.string().datetime(),
  /** Error message from the last attempt, or null if it succeeded. */
  last_error: z.string().nullable(),
  /** Conditional GET ETag for url sources. */
  etag: z.string().optional(),
  /** Conditional GET Last-Modified for url sources. */
  last_modified: z.string().optional(),
}));

export type RefreshCacheEntry = z.infer<typeof RefreshCacheEntrySchema>;

/**
 * Canonical filesystem-name sanitizer for `agent` and `sourceId` segments
 * of the per-source refresh-cache path. Same character class as
 * refresh-lock.ts (alphanum + dot/underscore/dash), applied per-segment
 * without the lock's 80-char slice — the nested directory layout (one dir
 * per agent, one file per source) makes path collisions far less likely
 * than the lock's flat single-filename case, so truncation isn't needed.
 *
 * Exported as the contract surface so `gui/server` can pin to the
 * IDENTICAL policy (see `gui/server/src/services/cache-paths.ts`); the
 * two had drifted historically and only kebab-case validation upstream
 * kept them aligned in practice.
 */
export function safeFsName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

function cachePath(cacheRoot: string, agent: string, sourceId: string): string {
  return join(cacheRoot, "agents", safeFsName(agent), "sources", `${safeFsName(sourceId)}.meta.json`);
}

/**
 * Read the refresh-cache entry for (`agent`, `sourceId`).
 *
 * Returns `undefined` when:
 *   - the file does not exist (ENOENT), or
 *   - the file is unparseable JSON or fails schema validation.
 *
 * Cache files are not user-edited, so a corrupt entry is treated as
 * "no entry" and will be silently overwritten by the next successful
 * refresh. Any other read error (permissions, EIO, ...) propagates.
 */
export async function readRefreshCache(
  cacheRoot: string,
  agent: string,
  sourceId: string,
): Promise<RefreshCacheEntry | undefined> {
  const path = cachePath(cacheRoot, agent, sourceId);
  // Defense-in-depth [v1-task B6]: agent / sourceId are sanitized by
  // safeFsName above, but reach here from many call paths (daemon,
  // session runner, CLI). Belt-and-suspenders before any IO. Only
  // assert when cacheRoot exists — readFile below treats ENOENT as
  // "no cache entry" and returns undefined.
  try {
    await stat(cacheRoot);
    await assertWithin(path, cacheRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = RefreshCacheEntrySchema.safeParse(parsed);
  if (!result.success) return undefined;
  return result.data;
}

/**
 * Write the refresh-cache entry for (`agent`, `sourceId`), creating the
 * parent directory if needed. Overwrites any existing entry.
 *
 * Uses a plain `mkdir` + `writeFile` (no temp-file+rename); matches the
 * write strategy of `refresh-manifest.ts`.
 */
export async function writeRefreshCache(
  cacheRoot: string,
  agent: string,
  sourceId: string,
  entry: RefreshCacheEntry,
): Promise<void> {
  const path = cachePath(cacheRoot, agent, sourceId);
  // Defense-in-depth [v1-task B6].
  await mkdir(cacheRoot, { recursive: true });
  await assertWithin(path, cacheRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/**
 * Milliseconds since `entry.last_refreshed_at`.
 *
 * Returns `Infinity` when the entry is undefined (= never refreshed) or
 * when the timestamp somehow fails `Date.parse` (defence-in-depth — the
 * schema already requires ISO8601). Negative results (clock skew) are
 * clamped to 0.
 */
export function cacheAgeMs(entry: RefreshCacheEntry | undefined, now: number): number {
  if (entry === undefined) return Number.POSITIVE_INFINITY;
  const t = Date.parse(entry.last_refreshed_at);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  const age = now - t;
  return age < 0 ? 0 : age;
}

/**
 * Build a RefreshCacheEntry from a refresh outcome and (optional) prior entry.
 *
 * Success: `last_refreshed_at` and `last_attempt_at` both advance to `now`;
 * `last_error` is null. `etag`/`last_modified` pass through from `prior`
 * when present.
 *
 * Failure: `last_attempt_at` advances to `now`; `last_error` is the new
 * error; `last_refreshed_at` is preserved from `prior` (so consumers know
 * the cached content is still the last-good) or seeded with `now` when no
 * prior exists. `etag`/`last_modified` pass through.
 *
 * Callers pass `now` as a pre-formatted ISO8601 string so tests can pin
 * it deterministically.
 */
export function mergeCacheEntry(args: {
  now: string;
  outcome: { ok: true } | { ok: false; error: string };
  prior?: RefreshCacheEntry | undefined;
}): RefreshCacheEntry {
  const { now, outcome, prior } = args;
  const carry = {
    ...(prior?.etag !== undefined ? { etag: prior.etag } : {}),
    ...(prior?.last_modified !== undefined ? { last_modified: prior.last_modified } : {}),
  };
  if (outcome.ok) {
    return {
      schemaVersion: 1,
      last_refreshed_at: now,
      last_attempt_at: now,
      last_error: null,
      ...carry,
    };
  }
  return {
    schemaVersion: 1,
    last_refreshed_at: prior?.last_refreshed_at ?? now,
    last_attempt_at: now,
    last_error: outcome.error,
    ...carry,
  };
}
