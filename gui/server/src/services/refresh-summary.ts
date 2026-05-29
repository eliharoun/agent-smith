/**
 * Bulk refresh summary: enumerate all registered agents, then for each
 * agent read the (joined) knowledge view to compute lastRefreshAt /
 * sourceCount / failingCount.
 *
 * Soft-fails per-agent: an agent whose bundle can't be located or whose
 * knowledge.yml is missing returns { sourceCount: 0, failingCount: 0 }
 * with no lastRefreshAt — the GUI sorts these to the bottom.
 *
 * Performance: per-agent I/O is one readdir of the refresh-cache dir +
 * one read of knowledge.yml. With typical agent counts (1-20) this is
 * a few-millisecond bulk endpoint; we don't memoize.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RefreshSummary } from "gui-shared";
import { parseKnowledgeConfig } from "./parse-knowledge-config";
import { loadRefreshCacheEntries } from "./parse-knowledge-manifest";
import { parseRegistrySources } from "./parse-registry";

export interface RefreshSummaryDeps {
  registryPath: string;
  agentSmithHome?: string;
  cacheRoot?: string;
}

async function locateBundleDir(agent: string, registryPath: string): Promise<string | null> {
  const sources = await parseRegistrySources(registryPath);
  for (const src of sources) {
    const dir = join(src.rootPath, agent);
    const cfg = join(dir, "agent.config.json");
    try {
      if ((await stat(cfg)).isFile()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

async function listRegisteredAgents(registryPath: string): Promise<string[]> {
  const sources = await parseRegistrySources(registryPath);
  const out = new Set<string>();
  for (const src of sources) {
    // Each source.rootPath is a directory containing one subdir per agent
    // (each with agent.config.json). We can leverage the same scan the
    // catalogs endpoint does, but to avoid coupling we duplicate the
    // readdir+stat dance here.
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(src.rootPath);
      for (const name of entries) {
        const cfg = join(src.rootPath, name, "agent.config.json");
        try {
          if ((await stat(cfg)).isFile()) out.add(name);
        } catch {
          // not an agent dir; skip
        }
      }
    } catch {
      // unreadable catalog; skip
    }
  }
  return [...out].sort();
}

export async function buildRefreshSummary(deps: RefreshSummaryDeps): Promise<RefreshSummary[]> {
  const agents = await listRegisteredAgents(deps.registryPath);
  const out: RefreshSummary[] = [];
  for (const agent of agents) {
    const bundleDir = await locateBundleDir(agent, deps.registryPath);
    if (!bundleDir) {
      out.push({ agent, sourceCount: 0, failingCount: 0 });
      continue;
    }
    let sourceCount = 0;
    try {
      const cfg = await parseKnowledgeConfig({
        configPath: join(bundleDir, "agent.config.json"),
      });
      sourceCount = cfg.sources.length;
    } catch {
      // knowledge.yml missing / malformed → no sources for this agent.
    }
    const cache = await loadRefreshCacheEntries(agent, deps.cacheRoot);
    let lastRefreshAt: string | undefined;
    let failingCount = 0;
    for (const entry of Object.values(cache)) {
      if (entry.last_error) failingCount += 1;
      const t = entry.last_refreshed_at;
      if (t && (!lastRefreshAt || t > lastRefreshAt)) lastRefreshAt = t;
    }
    out.push({
      agent,
      sourceCount,
      failingCount,
      ...(lastRefreshAt !== undefined ? { lastRefreshAt } : {}),
    });
  }
  return out;
}
