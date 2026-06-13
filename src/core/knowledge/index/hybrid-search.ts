import type { Embedder } from "./embedder";
import { ftsTokens } from "./fts-query";
import { RRF_C, SIM_FLOOR } from "./fusion-config";
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
  /** 1-based rank within each model's dense arm, keyed by embedder id. Every
   *  active model's id is present; the value is null when that model's arm did
   *  not return this chunk. */
  vectorRanks: Record<string, number | null>;
}

/** A per-query decomposition of hybrid retrieval, exposing what `hybridSearch`
 *  fuses away: each arm's ranked hits and the fused result with per-arm ranks. */
export interface SearchExplanation {
  query: string;
  /** True iff at least one dense (vector) arm ran. */
  hybrid: boolean;
  /** Lexical arm ranked hits (1-based rank in array order). */
  lexical: Array<{ relPath: string; rank: number }>;
  /** Per-model dense arm ranked hits, keyed by embedder id. Empty when lexical-only. */
  vectors: Record<string, Array<{ relPath: string; rank: number }>>;
  /** RRF-fused top-k, each annotated with its per-arm ranks and fused score. */
  fused: ExplainEntry[];
}

/** One dense arm per real embedder. Each arm searches its own embedder_id
 *  partition and is floored by SIM_FLOOR so weak (near-orthogonal) hits don't
 *  earn RRF credit. Returns [embedderId, rows] pairs in input order. */
async function denseArms(
  store: KnowledgeStore,
  embedders: Embedder[],
  query: string,
  k: number,
): Promise<Array<{ id: string; rows: SearchRow[] }>> {
  const arms: Array<{ id: string; rows: SearchRow[] }> = [];
  for (const emb of embedders) {
    if (emb.id === "none") continue;
    const [qv] = await emb.embed([query]);
    if (!qv) continue;
    const rows = store
      .searchVector(qv, Math.max(k, 20), emb.id)
      .filter((r) => (r.sim ?? 0) >= SIM_FLOOR);
    arms.push({ id: emb.id, rows });
  }
  return arms;
}

export async function explainSearch(
  store: KnowledgeStore,
  embedders: Embedder[],
  query: string,
  k: number,
): Promise<SearchExplanation> {
  const lexical = store.searchLexical(ftsTokens(query), Math.max(k, 20));
  const arms = await denseArms(store, embedders, query, k);
  const lexRank = new Map<string, number>();
  lexical.forEach((r, i) => lexRank.set(r.chunkId, i + 1));
  // per-model: chunkId -> rank
  const armRank = new Map<string, Map<string, number>>(); // embId -> (chunkId -> rank)
  for (const a of arms) {
    const m = new Map<string, number>();
    a.rows.forEach((r, i) => m.set(r.chunkId, i + 1));
    armRank.set(a.id, m);
  }
  const byId = new Map<string, SearchRow>();
  for (const r of [lexical, ...arms.map((a) => a.rows)].flat()) byId.set(r.chunkId, r);
  const fused = rrfFuse(
    [lexical, ...arms.map((a) => a.rows)].filter((l) => l.length > 0),
    (r) => r.chunkId,
    RRF_C,
  );
  const fusedEntries: ExplainEntry[] = fused.slice(0, k).map((f) => {
    const r = byId.get(f.key);
    if (!r) throw new Error(`fused key ${f.key} missing from byId`); // unreachable
    const vectorRanks: Record<string, number | null> = {};
    for (const a of arms) vectorRanks[a.id] = armRank.get(a.id)?.get(f.key) ?? null;
    return {
      relPath: r.relPath,
      path: r.relPath,
      startLine: r.startLine,
      endLine: r.endLine,
      kind: r.kind,
      snippet: r.text.slice(0, 200),
      fusedScore: f.score,
      lexicalRank: lexRank.get(f.key) ?? null,
      vectorRanks,
    };
  });
  const vectors: Record<string, Array<{ relPath: string; rank: number }>> = {};
  for (const a of arms) vectors[a.id] = a.rows.map((r, i) => ({ relPath: r.relPath, rank: i + 1 }));
  return {
    query,
    hybrid: arms.length > 0,
    lexical: lexical.map((r, i) => ({ relPath: r.relPath, rank: i + 1 })),
    vectors,
    fused: fusedEntries,
  };
}

export async function hybridSearch(
  store: KnowledgeStore,
  embedders: Embedder[],
  query: string,
  k: number,
): Promise<Hit[]> {
  const lexical = store.searchLexical(ftsTokens(query), Math.max(k, 20));
  const arms = await denseArms(store, embedders, query, k);
  const byId = new Map<string, SearchRow>();
  for (const r of [lexical, ...arms.map((a) => a.rows)].flat()) byId.set(r.chunkId, r);
  const fused = rrfFuse(
    [lexical, ...arms.map((a) => a.rows)].filter((l) => l.length > 0),
    (r) => r.chunkId,
    RRF_C,
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
