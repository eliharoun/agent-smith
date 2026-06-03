/**
 * Doctor section that summarizes the resolved URL-routing table — the union
 * of three routing layers smith consults at fetch time:
 *
 *   1. Curated registry (Layer 1) — `routing-registry.ts`. Domain-shaped
 *      patterns shipped with the smith binary; broadest fallback.
 *   2. Server-advertised `_meta` (Layer 2) — claims emitted by configured
 *      MCP servers via the `dev.agent-smith/fetchDomains` `_meta` key.
 *   3. User cache (Layer 3) — learned routes persisted to
 *      `<stateHome>/url-routing.json` after the user confirms a probe.
 *
 * The check is read-only by design — `smith doctor` does not mutate any
 * routing state. The companion CLI surface (`src/cli/commands/doctor.ts`)
 * wires the real cache loader and the `_meta`-claim discovery (which spawns
 * each available MCP server and calls `tools/list`); this module stays
 * pure-by-DI so unit tests don't touch a real `~/.config/agent-smith/`
 * directory or any MCP child process.
 *
 * Output shape:
 *   - `entries` is the merged routing table: one entry per
 *     `(urlPattern, source, server, tool)`. Same `(urlPattern, server, tool)`
 *     tuple from two layers produces two entries (one per source) so the
 *     doctor view shows the layering precisely.
 *   - `ambiguities` is the set of patterns claimed by more than one
 *     `(server, tool)` pair across the merged entries. Surfaced as warnings;
 *     informational only — the resolver picks the most-authoritative layer
 *     at fetch time.
 *
 * Order: curated entries in declaration order, then `_meta` claims in input
 * order, then cache entries in input order. Within a layer, ordering is
 * stable. Ambiguities are sorted lexicographically by `urlPattern`.
 */
import { _listPatterns } from "../knowledge/routing-registry";
import type { RouteCache } from "../knowledge/route-cache";
import type { MetaClaim } from "../knowledge/route-meta";

export type RouteSource = "curated" | "_meta" | "cache";

export interface ResolvedRouteEntry {
  urlPattern: string;
  source: RouteSource;
  server: string;
  tool: string;
}

export interface AmbiguityFinding {
  urlPattern: string;
  /**
   * Distinct `(server, tool)` pairs claiming this pattern. Order: stable
   * by first-seen across the merged entry list.
   */
  claimants: Array<{ server: string; tool: string; source: RouteSource }>;
}

export interface CheckUrlRoutingOpts {
  /** Loader for the user cache (Layer 3). Returns an empty cache when missing. */
  loadCache: () => Promise<RouteCache>;
  /**
   * Loader for advertised `_meta` claims (Layer 2). Walks each available
   * MCP server, spawns it, calls `tools/list`, and extracts claims.
   * Best-effort — implementations should swallow per-server errors and
   * return whatever subset succeeded.
   */
  listMetaClaims: () => Promise<MetaClaim[]>;
}

export interface CheckUrlRoutingResult {
  entries: ResolvedRouteEntry[];
  ambiguities: AmbiguityFinding[];
}

/**
 * Compose the merged routing table and surface any ambiguities.
 *
 * Pure-by-DI: every external read goes through `opts`. The function never
 * touches the filesystem or spawns child processes itself.
 */
export async function checkUrlRouting(
  opts: CheckUrlRoutingOpts,
): Promise<CheckUrlRoutingResult> {
  const entries: ResolvedRouteEntry[] = [];

  // Layer 1 — curated patterns. Each curated entry contributes its
  // human-readable `displayPattern` (or a fallback synthesized from the
  // server name when an entry is missing the field). Curated entries with
  // neither are silently skipped; the doctor view requires a printable
  // pattern.
  for (const p of _listPatterns()) {
    const urlPattern = p.displayPattern ?? `(curated:${p.server})`;
    entries.push({
      urlPattern,
      source: "curated",
      server: p.server,
      tool: p.tool,
    });
  }

  // Layer 2 — server-advertised `_meta` claims. One entry per claim's
  // `urlPatterns[]` element (a single tool may advertise multiple
  // patterns). Best-effort: the caller is responsible for swallowing
  // per-server errors before handing claims to us.
  const metaClaims = await opts.listMetaClaims();
  for (const claim of metaClaims) {
    for (const urlPattern of claim.urlPatterns) {
      entries.push({
        urlPattern,
        source: "_meta",
        server: claim.server,
        tool: claim.tool,
      });
    }
  }

  // Layer 3 — user cache. Each cache entry is one learned route; emit
  // verbatim.
  const cache = await opts.loadCache();
  for (const e of cache.entries) {
    entries.push({
      urlPattern: e.urlPattern,
      source: "cache",
      server: e.server,
      tool: e.tool,
    });
  }

  // Ambiguity detection: a pattern is ambiguous when more than one
  // distinct `(server, tool)` pair claims it. Two entries from different
  // layers with the same `(server, tool)` are NOT ambiguous — they're the
  // same route advertised twice. Iteration order preserves first-seen
  // ordering of claimants, then sort findings by pattern for determinism.
  const byPattern = new Map<
    string,
    Array<{ server: string; tool: string; source: RouteSource }>
  >();
  for (const e of entries) {
    const list = byPattern.get(e.urlPattern) ?? [];
    const exists = list.some((c) => c.server === e.server && c.tool === e.tool);
    if (!exists) list.push({ server: e.server, tool: e.tool, source: e.source });
    byPattern.set(e.urlPattern, list);
  }

  const ambiguities: AmbiguityFinding[] = [];
  for (const [urlPattern, claimants] of byPattern.entries()) {
    if (claimants.length > 1) {
      ambiguities.push({ urlPattern, claimants });
    }
  }
  ambiguities.sort((a, b) => a.urlPattern.localeCompare(b.urlPattern));

  return { entries, ambiguities };
}
