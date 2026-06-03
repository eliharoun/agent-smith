import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface RouteCacheEntry {
  urlPattern: string;
  server: string;
  tool: string;
  learnedAt: string;
  hits: number;
}

export interface RouteCache {
  schemaVersion: 1;
  entries: RouteCacheEntry[];
}

export const EMPTY_CACHE: RouteCache = { schemaVersion: 1, entries: [] };

export interface RouteCacheOpts {
  /** State home (typically `stateHome()` in production, tempdir in tests). */
  stateHome: string;
}

const FILENAME = "url-routing.json";

export async function loadRouteCache(opts: RouteCacheOpts): Promise<RouteCache> {
  let raw: string;
  try {
    raw = await readFile(join(opts.stateHome, FILENAME), "utf8");
  } catch {
    return EMPTY_CACHE;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CACHE;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: number }).schemaVersion !== 1 ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    return EMPTY_CACHE;
  }
  return parsed as RouteCache;
}

export async function saveRouteCache(opts: RouteCacheOpts, cache: RouteCache): Promise<void> {
  await mkdir(opts.stateHome, { recursive: true });
  const path = join(opts.stateHome, FILENAME);
  await writeFile(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

/**
 * Most-specific pattern wins on overlap — measured by literal-prefix length
 * before the first `**`.
 */
export function matchCachedRoute(cache: RouteCache, url: string): RouteCacheEntry | undefined {
  const matches = cache.entries
    .filter((e) => urlMatchesPattern(url, e.urlPattern))
    .sort((a, b) => specificity(b.urlPattern) - specificity(a.urlPattern));
  return matches[0];
}

function urlMatchesPattern(url: string, pattern: string): boolean {
  const literal = pattern.replace(/\*\*$/, "");
  return url.startsWith(literal);
}

function specificity(pattern: string): number {
  return pattern.replace(/\*\*$/, "").length;
}

/**
 * Upsert a route. Identity is `(server, tool, hostBase)` where hostBase is
 * the URL's `${protocol}//${host}` prefix. This means a probe to
 * `https://wiki.test/a` and a later probe to `https://wiki.test/b` collapse
 * into one entry (host-level routes), and the entry's pattern stays
 * host-wide as `https://wiki.test/**`.
 */
export function recordRoute(
  cache: RouteCache,
  args: { url: string; server: string; tool: string; now: string },
): RouteCache {
  const u = new URL(args.url);
  const hostBase = `${u.protocol}//${u.host}`;
  const pattern = `${hostBase}/**`;
  const existingIdx = cache.entries.findIndex(
    (e) => e.server === args.server && e.tool === args.tool && e.urlPattern === pattern,
  );
  if (existingIdx >= 0) {
    const next = [...cache.entries];
    const prev = next[existingIdx]!;
    next[existingIdx] = { ...prev, hits: prev.hits + 1, learnedAt: args.now };
    return { ...cache, entries: next };
  }
  return {
    ...cache,
    entries: [
      ...cache.entries,
      { urlPattern: pattern, server: args.server, tool: args.tool, learnedAt: args.now, hits: 1 },
    ],
  };
}
