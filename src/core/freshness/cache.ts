import type { SchemaCache } from "./types";

/** Pure: is the cache value still fresh relative to `now` and `ttlMs`? */
export function isCacheFresh(cache: SchemaCache | null, now: Date, ttlMs: number): boolean {
  if (cache === null) return false;
  const t = Date.parse(cache.fetchedAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < ttlMs;
}

export interface CacheIO {
  readCache: (path: string) => Promise<SchemaCache | null>;
  writeCache: (path: string, value: SchemaCache) => Promise<void>;
}

/** In-memory CacheIO for tests. Writes are pure-keyed by path. */
export function makeMemoryCacheIO(): CacheIO & { simulateCorrupted: (path: string) => void } {
  const store = new Map<string, SchemaCache>();
  const corrupted = new Set<string>();
  return {
    async readCache(path: string): Promise<SchemaCache | null> {
      if (corrupted.has(path)) return null;
      return store.get(path) ?? null;
    },
    async writeCache(path: string, value: SchemaCache): Promise<void> {
      store.set(path, value);
    },
    /**
     * Subsequent readCache(path) calls return null, as if the file were unparseable.
     * Sticky; cannot be undone. Writes to a corrupted path succeed but reads still return null.
     */
    simulateCorrupted(path: string): void {
      corrupted.add(path);
    },
  };
}
