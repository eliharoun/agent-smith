import type { Embedder } from "./embedder";
import { ftsTokens } from "./fts-query";
import type { KnowledgeStore, SearchRow } from "./store";

export interface FusedKey {
  key: string;
  score: number;
}
export function rrfFuse<T>(lists: T[][], keyOf: (t: T) => string, c: number): FusedKey[] {
  const s = new Map<string, number>();
  for (const list of lists)
    list.forEach((it, i) => {
      const k = keyOf(it);
      s.set(k, (s.get(k) ?? 0) + 1 / (c + i));
    });
  return [...s.entries()].map(([key, score]) => ({ key, score })).sort((a, b) => b.score - a.score);
}

export interface Hit {
  relPath: string;
  /** Back-compat alias of relPath: the legacy knowledge.search/bm25 contract
   *  emits `path` (see spec §3.5). Kept so existing MCP consumers that read
   *  `.path` keep working after the switch to hybrid search. */
  path: string;
  startLine: number;
  endLine: number;
  kind: string;
  score: number;
  snippet: string;
}

export async function hybridSearch(
  store: KnowledgeStore,
  embedder: Embedder,
  query: string,
  k: number,
): Promise<Hit[]> {
  const lexical = store.searchLexical(ftsTokens(query), Math.max(k, 20));
  let dense: SearchRow[] = [];
  if (embedder.id !== "none") {
    const [qv] = await embedder.embed([query]);
    if (qv) dense = store.searchVector(qv, Math.max(k, 20));
  }
  const byId = new Map<string, SearchRow>();
  for (const r of [...lexical, ...dense]) byId.set(r.chunkId, r);
  const fused = rrfFuse(
    [lexical, dense].filter((l) => l.length > 0),
    (r) => r.chunkId,
    60,
  );
  return fused.slice(0, k).map((f) => {
    const r = byId.get(f.key);
    if (!r) throw new Error(`fused key ${f.key} missing from byId`); // unreachable; satisfies strict null
    return {
      relPath: r.relPath,
      path: r.relPath,
      startLine: r.startLine,
      endLine: r.endLine,
      kind: r.kind,
      score: f.score,
      snippet: r.text.slice(0, 200),
    };
  });
}
