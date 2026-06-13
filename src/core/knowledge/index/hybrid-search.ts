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

/** One fused result with its provenance: the 1-based rank it held in each arm
 *  (null when that arm did not return it) and the RRF fused score. */
export interface ExplainEntry {
  relPath: string;
  path: string; // back-compat alias, mirrors Hit
  startLine: number;
  endLine: number;
  kind: string;
  snippet: string;
  fusedScore: number;
  /** 1-based rank in the lexical (BM25) arm, or null if absent. */
  lexicalRank: number | null;
  /** 1-based rank in the dense (vector) arm, or null if absent. */
  vectorRank: number | null;
}

/** A per-query decomposition of hybrid retrieval, exposing what `hybridSearch`
 *  fuses away: each arm's ranked hits and the fused result with per-arm ranks. */
export interface SearchExplanation {
  query: string;
  /** True iff the dense (vector) arm ran — i.e. a real embedder was provided. */
  hybrid: boolean;
  /** Lexical arm ranked hits (1-based rank in array order). */
  lexical: Array<{ relPath: string; rank: number }>;
  /** Dense arm ranked hits (1-based rank in array order). Empty when !hybrid. */
  vector: Array<{ relPath: string; rank: number }>;
  /** RRF-fused top-k, each annotated with its per-arm ranks and fused score. */
  fused: ExplainEntry[];
}

export async function explainSearch(
  store: KnowledgeStore,
  embedder: Embedder,
  query: string,
  k: number,
): Promise<SearchExplanation> {
  const lexical = store.searchLexical(ftsTokens(query), Math.max(k, 20));
  let dense: SearchRow[] = [];
  if (embedder.id !== "none") {
    const [qv] = await embedder.embed([query]);
    if (qv) dense = store.searchVector(qv, Math.max(k, 20), embedder.id);
  }
  const lexRank = new Map<string, number>();
  lexical.forEach((r, i) => lexRank.set(r.chunkId, i + 1));
  const vecRank = new Map<string, number>();
  dense.forEach((r, i) => vecRank.set(r.chunkId, i + 1));

  const byId = new Map<string, SearchRow>();
  for (const r of [...lexical, ...dense]) byId.set(r.chunkId, r);

  const fused = rrfFuse(
    [lexical, dense].filter((l) => l.length > 0),
    (r) => r.chunkId,
    60,
  );
  const fusedEntries: ExplainEntry[] = fused.slice(0, k).map((f) => {
    const r = byId.get(f.key);
    if (!r) throw new Error(`fused key ${f.key} missing from byId`); // unreachable
    return {
      relPath: r.relPath,
      path: r.relPath,
      startLine: r.startLine,
      endLine: r.endLine,
      kind: r.kind,
      snippet: r.text.slice(0, 200),
      fusedScore: f.score,
      lexicalRank: lexRank.get(f.key) ?? null,
      vectorRank: vecRank.get(f.key) ?? null,
    };
  });
  return {
    query,
    hybrid: embedder.id !== "none",
    lexical: lexical.map((r, i) => ({ relPath: r.relPath, rank: i + 1 })),
    vector: dense.map((r, i) => ({ relPath: r.relPath, rank: i + 1 })),
    fused: fusedEntries,
  };
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
    if (qv) dense = store.searchVector(qv, Math.max(k, 20), embedder.id);
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
