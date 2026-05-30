// src/daemon/refresh-loop.ts
//
// Periodic TTL-based refresh tick used by the daemon. Pure function over
// injected state: enumerate (agent, source) pairs that declared
// `refresh.mode === "ttl"`, check each source's cache age against its
// declared TTL, and call the injected `refreshSource` primitive for any
// that are stale (or never cached). Outcomes are written back to the
// per-source refresh-cache entry, preserving any prior conditional-GET
// headers (etag / last_modified).
//
// This module is deliberately decoupled from the daemon's other loops
// (git-pull, heartbeat) so its cadence, failure modes, and tests are
// independent. The daemon wires it onto its own dedicated setInterval.

import {
  cacheAgeMs,
  mergeCacheEntry,
  readRefreshCache,
  writeRefreshCache,
} from "../core/knowledge/refresh-cache";

export interface TtlSource {
  id: string;
  /** TTL in milliseconds (computed from declared "1h"/"1d"/"1w" at enumeration time). */
  ttlMs: number;
}

export interface TtlAgent {
  name: string;
  sources: TtlSource[];
}

export interface TickInput {
  now: number;
  cacheRoot: string;
  agents: TtlAgent[];
  refreshSource: (
    agent: string,
    sourceId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface TickResult {
  refreshed: Array<{ agent: string; sourceId: string }>;
  failed: Array<{ agent: string; sourceId: string; error: string }>;
  skipped: Array<{ agent: string; sourceId: string; reason: "fresh" }>;
}

export async function tickRefreshLoop(input: TickInput): Promise<TickResult> {
  const result: TickResult = { refreshed: [], failed: [], skipped: [] };

  for (const agent of input.agents) {
    for (const source of agent.sources) {
      const entry = await readRefreshCache(input.cacheRoot, agent.name, source.id);
      const ageMs = cacheAgeMs(entry, input.now);
      if (ageMs < source.ttlMs) {
        result.skipped.push({ agent: agent.name, sourceId: source.id, reason: "fresh" });
        continue;
      }
      const r = await input.refreshSource(agent.name, source.id);
      const nowIso = new Date(input.now).toISOString();
      const merged = mergeCacheEntry({ now: nowIso, outcome: r, prior: entry });
      await writeRefreshCache(input.cacheRoot, agent.name, source.id, merged);
      if (r.ok) {
        result.refreshed.push({ agent: agent.name, sourceId: source.id });
      } else {
        result.failed.push({ agent: agent.name, sourceId: source.id, error: r.error });
      }
    }
  }
  return result;
}
