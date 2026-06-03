import { findRoute as findCuratedRoute } from "./routing-registry";
import { matchCachedRoute, type RouteCache } from "./route-cache";
import { matchMetaClaim, type MetaClaim } from "./route-meta";

export interface ResolvedRoute {
  server: string;
  tool: string;
  source: "cache" | "_meta" | "curated";
}

export interface ResolveRouteInput {
  url: string;
  cache: RouteCache;
  metaClaims: MetaClaim[];
}

/**
 * Three-layer composer.
 *
 * Resolution order:
 *   1. User cache (Layer 3) — most authoritative; the user already confirmed.
 *   2. _meta self-claim (Layer 2) — server-advertised; trust by opt-in.
 *   3. Curated registry (Layer 1) — smith-curated; broadest fallback.
 *
 * Returns null when no layer matches. The caller decides whether to fall
 * through to direct HTTP, prompt the user, or surface an error.
 */
export function resolveRoute(input: ResolveRouteInput): ResolvedRoute | null {
  const cached = matchCachedRoute(input.cache, input.url);
  if (cached) {
    return { server: cached.server, tool: cached.tool, source: "cache" };
  }
  const meta = matchMetaClaim(input.metaClaims, input.url);
  if (meta) {
    return { server: meta.server, tool: meta.tool, source: "_meta" };
  }
  const curated = findCuratedRoute(input.url);
  if (curated) {
    return { server: curated.server, tool: curated.tool, source: "curated" };
  }
  return null;
}
