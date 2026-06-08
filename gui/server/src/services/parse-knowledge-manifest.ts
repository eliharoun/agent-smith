import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { KnowledgeManifest, RefreshCacheEntry } from "../../../shared/src/index";
import { knowledgeManifestPathFor, refreshCacheDirFor } from "./cache-paths";

export async function loadKnowledgeManifest(
  agent: string,
  agentSmithHome?: string,
): Promise<ReturnType<typeof KnowledgeManifest.parse> | undefined> {
  const p = knowledgeManifestPathFor(agent, agentSmithHome);
  try {
    const raw = await readFile(p, "utf8");
    return KnowledgeManifest.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function loadRefreshCacheEntries(
  agent: string,
  cacheRoot?: string,
): Promise<Record<string, ReturnType<typeof RefreshCacheEntry.parse>>> {
  const dir = refreshCacheDirFor(agent, cacheRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const out: Record<string, ReturnType<typeof RefreshCacheEntry.parse>> = {};
  for (const name of entries) {
    if (!name.endsWith(".meta.json")) continue;
    const sourceId = name.slice(0, -".meta.json".length);
    try {
      const raw = await readFile(join(dir, name), "utf8");
      out[sourceId] = RefreshCacheEntry.parse(JSON.parse(raw));
    } catch {
      // skip malformed entries
    }
  }
  return out;
}
