// src/core/knowledge/index/store.ts
//
// Hybrid knowledge store backed by `bun:sqlite` (built into the Bun runtime the
// `smith` CLI re-execs under). It holds FTS5 (lexical BM25) plus dense vectors
// stored as a BLOB column on `chunks`, scored by an in-JS cosine scan.
//
// Why not better-sqlite3 + sqlite-vec: Bun cannot load `better-sqlite3` (N-API
// native module, oven-sh/bun#4290), and `bun:sqlite` has FTS5 but no dynamic
// extension loading (so sqlite-vec's vec0 can't load either). bun:sqlite + a
// BLOB column + flat cosine keeps the whole design, drops the native dep, and
// is fine for knowledge-base sizes (thousands of chunks).
//
// ALL database access is isolated in this file; the rest of the codebase never
// imports a SQLite driver directly. `open()` returns null when the store can't
// be opened (missing file in readonly mode, or any driver error), so callers
// degrade to the in-memory Bm25Index.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export type ChunkKind = "code" | "prose" | "json";

export interface ChunkRow {
  id: string;
  sourceId: string;
  relPath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  text: string;
  contentHash: string;
  vector?: Float32Array;
  embedderId?: string;
  embedderDim?: number;
}
export interface StoreHeader {
  schemaVersion: number;
  /** Models that should be present this build, by recorded id. Empty =>
   *  lexical-only (NullEmbedder) session. Replaces the old scalar
   *  embedderId/embedderDim. */
  embedders: Array<{ id: string; dim: number }>;
  chunkerVersion: number;
  /** Bumped when the model policy (which model embeds which kind) changes.
   *  Like chunkerVersion, a mismatch broadly invalidates the index so the next
   *  build fully re-derives every chunk under the new policy — an incremental
   *  refresh alone would leave the affected partition stale/empty. */
  modelPolicyVersion: number;
  repomapVersion: number;
}
export interface SearchRow {
  chunkId: string;
  relPath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  text: string;
  rank: number;
  /** Raw cosine similarity for vector hits (for RRF floor gating). Unset on
   *  lexical rows from searchLexical. */
  sim?: number;
}
export interface TagRow {
  relPath: string;
  contentHash: string;
  name: string;
  role: "def" | "ref";
  line: number;
  signature: string;
}
export interface StoreOpenNotice {
  /** `rebuilt`: a stale/incompatible DB was deleted and recreated.
   *  `transient`: a recoverable (busy/locked) error; DB left intact for retry.
   *  `failed`: rebuild attempted but still failed; DB unusable this run. */
  kind: "rebuilt" | "transient" | "failed";
  detail: string;
}
export interface OpenOpts {
  readonly?: boolean;
  /** Optional sink for self-heal diagnostics. Undefined => silent (callers that
   *  don't care are unaffected). */
  onNotice?: (notice: StoreOpenNotice) => void;
}
export interface IndexStats {
  /** Distinct models over LIVE vectors (empty => lexical-only / no vectors). */
  embedders: Array<{ id: string; dim: number }>;
  /** Total chunk rows. */
  chunks: number;
  /** Chunks with a non-null embedding BLOB. */
  vectors: number;
  /** Distinct rel_paths present in the tags table (code-mapped files). */
  taggedPaths: number;
  /** Per-source counts + which model ids embedded that source's live vectors. */
  perSource: Array<{ sourceId: string; chunks: number; vectors: number; models: string[] }>;
}

/** Minimal structural type for the slice of `bun:sqlite`'s Database we use, so
 *  this module type-checks without a hard top-level import of `bun:sqlite`. */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDb {
  exec(sql: string): void;
  query(sql: string): SqliteStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

/** A row as stored, including the raw embedding BLOB for the cosine scan. */
interface RawChunkRow {
  chunkId: string;
  relPath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  text: string;
  embedding: Uint8Array | null;
  embedderId: string | null;
  embedderDim: number | null;
}

export class KnowledgeStore {
  private constructor(
    private db: SqliteDb,
    readonly header: StoreHeader,
    readonly readonly_: boolean,
  ) {}

  static async open(
    dbPath: string,
    header: StoreHeader,
    opts: OpenOpts = {},
  ): Promise<KnowledgeStore | null> {
    let Database: new (path: string, opts?: { readonly?: boolean; create?: boolean }) => SqliteDb;
    try {
      ({ Database } = (await import("bun:sqlite")) as unknown as {
        Database: new (path: string, opts?: { readonly?: boolean; create?: boolean }) => SqliteDb;
      });
    } catch {
      return null; // not running under Bun -> caller falls back to in-memory BM25
    }

    try {
      if (opts.readonly) {
        if (!existsSync(dbPath)) return null;
        const db = new Database(dbPath, { readonly: true });
        // Readonly opens skip migrate(), so a stale on-disk schema (e.g. built
        // before a column was added) would make column-specific queries throw.
        // The `meta` table exists in every schema version, so read the stored
        // schemaVersion and refuse to use a mismatched index — callers then
        // degrade cleanly (serve -> in-memory BM25; info -> not materialized)
        // until the next writable open rebuilds it.
        const row = db.query("SELECT value FROM meta WHERE key='schemaVersion'").get() as
          | { value: string }
          | undefined;
        if (!row || Number(row.value) !== header.schemaVersion) {
          db.close();
          return null;
        }
        return new KnowledgeStore(db, header, true);
      }
      mkdirSync(dirname(dbPath), { recursive: true });
      const openAndMigrate = (): KnowledgeStore => {
        const db = new Database(dbPath, { create: true });
        db.exec("PRAGMA journal_mode = WAL");
        const s = new KnowledgeStore(db, header, false);
        s.migrate();
        return s;
      };
      try {
        return openAndMigrate();
      } catch (e) {
        // Recoverable (busy/locked): preserve the DB; a live reader is intact and
        // the next run retries. Never delete on contention.
        if (isRecoverableSqliteError(e)) {
          opts.onNotice?.({
            kind: "transient",
            detail: e instanceof Error ? e.message : String(e),
          });
          return null;
        }
        // Non-recoverable (stale shape the drop can't fix, malformed image):
        // delete the DB + sidecars and rebuild ONCE. Never loops.
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            rmSync(dbPath + suffix, { force: true });
          } catch {
            /* best-effort */
          }
        }
        try {
          const s = openAndMigrate();
          opts.onNotice?.({ kind: "rebuilt", detail: e instanceof Error ? e.message : String(e) });
          return s;
        } catch (e2) {
          opts.onNotice?.({
            kind: "failed",
            detail: e2 instanceof Error ? e2.message : String(e2),
          });
          return null;
        }
      }
    } catch {
      return null; // driver/import failure -> degrade gracefully
    }
  }

  private ddlBase(): void {
    // `embedding` is a raw little-endian float32 BLOB (or NULL when the chunk
    // has not been embedded). FTS5 is external-content over `chunks`.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, source_id TEXT, rel_path TEXT, start_line INTEGER,
        end_line INTEGER, kind TEXT, text TEXT, content_hash TEXT,
        embedding BLOB, embedder_id TEXT, embedder_dim INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_relpath ON chunks(rel_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_embedder ON chunks(embedder_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='chunks', content_rowid='rowid');
      CREATE TABLE IF NOT EXISTS tags (
        rel_path TEXT, content_hash TEXT, name TEXT, role TEXT, line INTEGER, signature TEXT
      );
    `);
  }

  private migrate(): void {
    // `meta` is schema-stable across all versions; ensure it exists first so the
    // prior schemaVersion is readable BEFORE any version-specific DDL runs.
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    // Destructive schema-version migration MUST precede ddlBase(): ddlBase creates
    // current-schema structures (e.g. `idx_chunks_embedder ON chunks(embedder_id)`)
    // that reference columns a stale table lacks, which would throw before any
    // later drop could run. Drop stale data tables here so ddlBase rebuilds clean.
    const storedSchema = this.read("schemaVersion");
    if (storedSchema !== undefined && Number(storedSchema) !== this.header.schemaVersion) {
      this.db.exec(
        "DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS fts; DROP TABLE IF EXISTS tags;",
      );
    }
    this.ddlBase();
    this.reconcileHeader();
  }

  private read(k: string): string | undefined {
    return (
      this.db.query("SELECT value FROM meta WHERE key=?").get(k) as { value: string } | undefined
    )?.value;
  }
  private write(k: string, v: string): void {
    this.db
      .query(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(k, v);
  }

  /** Recursion-safe: header values are written BEFORE any rebuild. `meta` is
   *  never dropped, so a re-entry would see the NEW values and stop. */
  private reconcileHeader(): void {
    const storedChunker = this.read("chunkerVersion");
    const storedPolicy = this.read("modelPolicyVersion");
    const storedRepomap = this.read("repomapVersion");
    // Parse the prior model set defensively: unparseable/missing => empty,
    // never throw (a throw bubbles to open()'s catch -> silent BM25 fallback,
    // making the whole persistent index vanish from serve).
    let storedModels: Array<{ id: string; dim: number }> = [];
    try {
      const raw = this.read("embedders");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) storedModels = parsed;
      }
    } catch {
      storedModels = [];
    }

    // Write running header FIRST (recursion-safe).
    this.write("schemaVersion", String(this.header.schemaVersion));
    this.write("chunkerVersion", String(this.header.chunkerVersion));
    this.write("modelPolicyVersion", String(this.header.modelPolicyVersion));
    this.write("repomapVersion", String(this.header.repomapVersion));
    // Persist the running model set, but NEVER clobber a recorded non-empty set
    // with an empty (lexical-only this-session) one — "empty" means "no models
    // loaded this session", not "the index has no vectors". Mirrors the old
    // "none must not clobber a real id" guard, now per-set.
    if (this.header.embedders.length > 0) {
      this.write("embedders", JSON.stringify(this.header.embedders));
    } else if (this.read("embedders") === undefined) {
      this.write("embedders", JSON.stringify([]));
    }

    const chunkerChanged = storedChunker && Number(storedChunker) !== this.header.chunkerVersion;
    const policyChanged = storedPolicy && Number(storedPolicy) !== this.header.modelPolicyVersion;
    if (chunkerChanged || policyChanged) {
      // Chunk boundaries OR the model policy changed -> all chunks (and their
      // embeddings) are stale. Broad clear so the next build fully re-derives;
      // avoids a stale/empty semantic partition that an incremental refresh
      // (changedPaths only) would never refill (§model-policy invalidation).
      this.db.exec("DELETE FROM chunks; DELETE FROM fts;");
    } else if (this.header.embedders.length > 0) {
      // Per-model clear: any previously-recorded model NOT in the running set
      // (its kind's model changed/removed) has its vectors cleared so the next
      // build re-embeds with the new model. Code-model change must not touch
      // prose vectors, and vice versa. Guarded by length>0 so a lexical-only
      // session never clears anything.
      const runningIds = new Set(this.header.embedders.map((m) => m.id));
      for (const sm of storedModels) {
        if (sm.id && sm.id !== "none" && !runningIds.has(sm.id)) {
          this.db
            .query(
              "UPDATE chunks SET embedding = NULL, embedder_id = NULL, embedder_dim = NULL WHERE embedder_id = ?",
            )
            .run(sm.id);
        }
      }
    }
    if (storedRepomap && Number(storedRepomap) !== this.header.repomapVersion) {
      this.db.exec("DELETE FROM tags;");
    }
  }

  upsertChunks(rows: ChunkRow[]): void {
    const insChunk = this.db.query(
      "INSERT INTO chunks(id,source_id,rel_path,start_line,end_line,kind,text,content_hash,embedding,embedder_id,embedder_dim) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, content_hash=excluded.content_hash, embedding=excluded.embedding, embedder_id=excluded.embedder_id, embedder_dim=excluded.embedder_dim",
    );
    // FTS5 external-content tables do NOT auto-sync on UPDATE. On the re-upsert
    // (incremental reindex) path the rowid is reused but the OLD posting would
    // linger, producing stale false-positive hits. So delete the old posting
    // using the chunk's CURRENT (pre-update) text BEFORE overwriting the row —
    // same idiom as deleteByPath. A no-op for brand-new ids (SELECT matches none).
    const delFts = this.db.query(
      "INSERT INTO fts(fts, rowid, text) SELECT 'delete', rowid, text FROM chunks WHERE id=?",
    );
    const insFts = this.db.query(
      "INSERT INTO fts(rowid, text) SELECT rowid, text FROM chunks WHERE id=?",
    );
    const tx = this.db.transaction((items: ChunkRow[]) => {
      for (const r of items) {
        delFts.run(r.id); // remove stale posting (reads OLD text) before the upsert
        insChunk.run(
          r.id,
          r.sourceId,
          r.relPath,
          r.startLine,
          r.endLine,
          r.kind,
          r.text,
          r.contentHash,
          r.vector ? toBlob(r.vector) : null,
          r.vector ? (r.embedderId ?? null) : null,
          r.vector ? (r.embedderDim ?? null) : null,
        );
        insFts.run(r.id);
      }
    });
    tx(rows);
  }

  deleteByPath(relPath: string): void {
    const ids = this.db
      .query("SELECT id, rowid, text FROM chunks WHERE rel_path=?")
      .all(relPath) as { id: string; rowid: number; text: string }[];
    const delFts = this.db.query("INSERT INTO fts(fts, rowid, text) VALUES('delete', ?, ?)");
    const delChunk = this.db.query("DELETE FROM chunks WHERE id=?");
    const tx = this.db.transaction(() => {
      for (const row of ids) {
        delFts.run(row.rowid, row.text); // external-content delete idiom
        delChunk.run(row.id);
      }
    });
    tx();
  }

  /** Clear the dense vector for a path (keep the chunks + FTS). Used when a
   *  source stops being hybrid — its lexical search stays, vectors go. */
  clearVectorsByPath(relPath: string): void {
    this.db.query("UPDATE chunks SET embedding = NULL WHERE rel_path = ?").run(relPath);
  }

  upsertTags(
    relPath: string,
    contentHash: string,
    tags: Omit<TagRow, "relPath" | "contentHash">[],
  ): void {
    const del = this.db.query("DELETE FROM tags WHERE rel_path=?");
    const ins = this.db.query(
      "INSERT INTO tags(rel_path,content_hash,name,role,line,signature) VALUES(?,?,?,?,?,?)",
    );
    const tx = this.db.transaction(() => {
      del.run(relPath);
      for (const t of tags) ins.run(relPath, contentHash, t.name, t.role, t.line, t.signature);
    });
    tx();
  }

  allTags(): TagRow[] {
    return this.db
      .query(
        "SELECT rel_path AS relPath, content_hash AS contentHash, name, role, line, signature FROM tags",
      )
      .all() as TagRow[];
  }

  searchLexical(tokens: string[], k: number): SearchRow[] {
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    return this.db
      .query(
        `SELECT c.id AS chunkId, c.rel_path AS relPath, c.start_line AS startLine, c.end_line AS endLine, c.kind AS kind, c.text AS text, bm25(fts) AS rank
         FROM fts JOIN chunks c ON c.rowid = fts.rowid WHERE fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, k) as SearchRow[];
  }

  /** In-JS cosine KNN over ONE model's vectors. `embedderId` partitions the
   *  scan so a query in model A's space is never compared against model B's
   *  vectors (incompatible spaces, even at equal dimension). Returns top-k by
   *  ascending distance; `sim` is the raw cosine similarity (for RRF floor
   *  gating). The dim check remains as a cheap backstop, but the embedder_id
   *  filter is the real cross-model guard. */
  searchVector(query: Float32Array, k: number, embedderId: string): SearchRow[] {
    const rows = this.db
      .query(
        "SELECT id AS chunkId, rel_path AS relPath, start_line AS startLine, end_line AS endLine, kind AS kind, text AS text, embedding FROM chunks WHERE embedding IS NOT NULL AND embedder_id = ?",
      )
      .all(embedderId) as RawChunkRow[];
    const qNorm = norm(query);
    if (qNorm === 0) return [];
    const scored: SearchRow[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const vec = fromBlob(row.embedding);
      if (vec.length !== query.length) continue; // backstop; embedder_id filter is the real guard
      const sim = cosine(query, vec, qNorm);
      scored.push({
        chunkId: row.chunkId,
        relPath: row.relPath,
        startLine: row.startLine,
        endLine: row.endLine,
        kind: row.kind,
        text: row.text,
        rank: 1 - sim, // distance: smaller is nearer
        sim,
      });
    }
    scored.sort((a, b) => a.rank - b.rank);
    return scored.slice(0, k);
  }

  contentHashFor(relPath: string): string | null {
    const r = this.db
      .query("SELECT content_hash AS h FROM chunks WHERE rel_path=? LIMIT 1")
      .get(relPath) as { h: string } | undefined;
    return r?.h ?? null;
  }
  hasVector(relPath: string): boolean {
    const r = this.db
      .query("SELECT 1 AS x FROM chunks WHERE rel_path=? AND embedding IS NOT NULL LIMIT 1")
      .get(relPath) as { x: number } | undefined;
    return !!r;
  }
  hasVectorFor(relPath: string, embedderId: string): boolean {
    const r = this.db
      .query(
        "SELECT 1 AS x FROM chunks WHERE rel_path=? AND embedding IS NOT NULL AND embedder_id=? LIMIT 1",
      )
      .get(relPath, embedderId) as { x: number } | undefined;
    return !!r;
  }
  allRelPaths(): string[] {
    return (
      this.db.query("SELECT DISTINCT rel_path AS r FROM chunks").all() as { r: string }[]
    ).map((x) => x.r);
  }
  hasCode(): boolean {
    return !!this.db.query("SELECT 1 AS x FROM tags LIMIT 1").get();
  }
  /** Distinct models over LIVE vectors (embedding present). Drives serve's
   *  model load + hybridActive. A vector-cleared row's stale embedder_id is
   *  excluded by the `embedding IS NOT NULL` filter. */
  storedEmbedderIds(): Array<{ id: string; dim: number }> {
    return this.db
      .query(
        "SELECT DISTINCT embedder_id AS id, embedder_dim AS dim FROM chunks WHERE embedding IS NOT NULL AND embedder_id IS NOT NULL",
      )
      .all() as Array<{ id: string; dim: number }>;
  }

  /** @deprecated single-model shim; prefer storedEmbedderIds(). Returns the
   *  first live model id, or "none" when lexical-only. */
  storedEmbedderId(): string | null {
    return this.storedEmbedderIds()[0]?.id ?? "none";
  }
  /** Aggregate index health for diagnostics (read-only; safe in readonly mode).
   *  Vector count uses `embedding IS NOT NULL`; taggedPaths counts distinct
   *  rel_paths in `tags`. perSource is sorted by sourceId for deterministic
   *  output. */
  stats(): IndexStats {
    const totals = this.db
      .query(
        "SELECT count(*) AS c, sum(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS v FROM chunks",
      )
      .get() as { c: number; v: number | null };
    const tagged = this.db.query("SELECT count(DISTINCT rel_path) AS c FROM tags").get() as {
      c: number;
    };
    // Which live-vector model ids embedded each source. Grouped over live
    // vectors so a vector-cleared row's stale embedder_id is excluded.
    const modelsBySource = new Map<string, string[]>();
    for (const r of this.db
      .query(
        "SELECT source_id AS sourceId, embedder_id AS embedderId FROM chunks WHERE embedding IS NOT NULL AND embedder_id IS NOT NULL GROUP BY source_id, embedder_id",
      )
      .all() as { sourceId: string; embedderId: string }[]) {
      const arr = modelsBySource.get(r.sourceId) ?? [];
      arr.push(r.embedderId);
      modelsBySource.set(r.sourceId, arr);
    }
    const perSource = (
      this.db
        .query(
          "SELECT source_id AS sourceId, count(*) AS chunks, sum(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS vectors FROM chunks GROUP BY source_id ORDER BY source_id ASC",
        )
        .all() as { sourceId: string; chunks: number; vectors: number | null }[]
    ).map((r) => ({
      sourceId: r.sourceId,
      chunks: r.chunks,
      vectors: r.vectors ?? 0,
      models: (modelsBySource.get(r.sourceId) ?? []).slice().sort(),
    }));
    return {
      embedders: this.storedEmbedderIds(),
      chunks: totals.c,
      vectors: totals.v ?? 0,
      taggedPaths: tagged.c,
      perSource,
    };
  }
  close(): void {
    this.db.close();
  }
}

/** True for SQLite errors that are transient (the DB is fine, just contended):
 *  a concurrent writer/reader holding a lock. These MUST NOT trigger the
 *  delete-and-rebuild self-heal — deleting a healthy DB out from under a live
 *  reader is worse than the failure. Everything else (schema/shape mismatch,
 *  malformed image) is treated as non-recoverable and is safe to rebuild. */
export function isRecoverableSqliteError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  const codeStr = typeof code === "string" ? code : "";
  const msg = e instanceof Error ? e.message : String(e);
  return /SQLITE_BUSY|SQLITE_LOCKED/i.test(codeStr) || /database is (locked|busy)/i.test(msg);
}

/** Pack a Float32Array as a Uint8Array view for BLOB binding (no copy). */
function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/** Read a BLOB back into a Float32Array. Copies into an aligned buffer because
 *  the stored Uint8Array's byteOffset is not guaranteed 4-byte aligned. */
function fromBlob(b: Uint8Array): Float32Array {
  const aligned = new Uint8Array(b.byteLength);
  aligned.set(b);
  return new Float32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));
}

function norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

/** Cosine similarity; `aNorm` precomputed for the query. Returns 0 if either is degenerate. */
function cosine(a: Float32Array, b: Float32Array, aNorm: number): number {
  let dot = 0;
  let bSq = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    bSq += b[i]! * b[i]!;
  }
  const denom = aNorm * Math.sqrt(bSq);
  return denom === 0 ? 0 : dot / denom;
}
