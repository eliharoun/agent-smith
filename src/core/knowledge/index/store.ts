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

import { existsSync, mkdirSync } from "node:fs";
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
}
export interface StoreHeader {
  schemaVersion: number;
  embedderId: string;
  embedderDim: number;
  chunkerVersion: number;
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
}
export interface TagRow {
  relPath: string;
  contentHash: string;
  name: string;
  role: "def" | "ref";
  line: number;
  signature: string;
}
export interface OpenOpts {
  readonly?: boolean;
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
        return new KnowledgeStore(db, header, true);
      }
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec("PRAGMA journal_mode = WAL");
      const store = new KnowledgeStore(db, header, false);
      store.migrate();
      return store;
    } catch {
      return null; // corrupt DB / permissions / etc. -> degrade gracefully
    }
  }

  private ddlBase(): void {
    // `embedding` is a raw little-endian float32 BLOB (or NULL when the chunk
    // has not been embedded). FTS5 is external-content over `chunks`.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, source_id TEXT, rel_path TEXT, start_line INTEGER,
        end_line INTEGER, kind TEXT, text TEXT, content_hash TEXT, embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_relpath ON chunks(rel_path);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='chunks', content_rowid='rowid');
      CREATE TABLE IF NOT EXISTS tags (
        rel_path TEXT, content_hash TEXT, name TEXT, role TEXT, line INTEGER, signature TEXT
      );
    `);
  }

  private migrate(): void {
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
    const storedSchema = this.read("schemaVersion");
    const storedEmbId = this.read("embedderId");
    const storedDim = this.read("embedderDim");
    const storedChunker = this.read("chunkerVersion");
    const storedRepomap = this.read("repomapVersion");

    // Write the running header FIRST (prevents recursion on any re-entry).
    this.write("schemaVersion", String(this.header.schemaVersion));
    // Do NOT clobber a real, recorded embedderId with "none". A lexical-only
    // build (NullEmbedder → id "none") must not erase the model identity that a
    // prior hybrid build recorded, or storedEmbedderId() would report "none" and
    // the serve process would stop loading the query embedder, making existing
    // vectors unreachable. "none" means "no embedder THIS session", not "the
    // index has no vectors".
    if (this.header.embedderId !== "none") {
      this.write("embedderId", this.header.embedderId);
      this.write("embedderDim", String(this.header.embedderDim));
    } else if (storedEmbId === undefined) {
      // First-ever build with no embedder: record "none" so the header exists.
      this.write("embedderId", "none");
      this.write("embedderDim", String(this.header.embedderDim));
    }
    this.write("chunkerVersion", String(this.header.chunkerVersion));
    this.write("repomapVersion", String(this.header.repomapVersion));

    if (storedSchema && Number(storedSchema) !== this.header.schemaVersion) {
      this.db.exec(
        "DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS fts; DROP TABLE IF EXISTS tags;",
      );
      this.ddlBase();
      return; // meta already holds new values; no re-reconcile.
    }
    if (storedChunker && Number(storedChunker) !== this.header.chunkerVersion) {
      // Chunk boundaries changed -> all chunks (and their embeddings) are stale.
      this.db.exec("DELETE FROM chunks; DELETE FROM fts;");
    } else {
      // Embedder change clears the embedding column (re-embed on next build) —
      // but ONLY between two real, different ids. 'none' = "unavailable this
      // session"; never clear vectors on it.
      const idChanged =
        storedEmbId &&
        storedEmbId !== "none" &&
        this.header.embedderId !== "none" &&
        storedEmbId !== this.header.embedderId;
      const dimChanged = storedDim && Number(storedDim) !== this.header.embedderDim;
      if (
        idChanged ||
        (dimChanged && this.header.embedderId !== "none" && storedEmbId !== "none")
      ) {
        this.db.exec("UPDATE chunks SET embedding = NULL");
      }
    }
    if (storedRepomap && Number(storedRepomap) !== this.header.repomapVersion) {
      this.db.exec("DELETE FROM tags;");
    }
  }

  upsertChunks(rows: ChunkRow[]): void {
    const insChunk = this.db.query(
      "INSERT INTO chunks(id,source_id,rel_path,start_line,end_line,kind,text,content_hash,embedding) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, content_hash=excluded.content_hash, embedding=excluded.embedding",
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

  /** In-JS cosine KNN over the embedding BLOB column. Returns the top-k by
   *  ascending distance (1 - cosine), so smaller `rank` is nearer — matching
   *  the lexical `bm25` convention. Rows whose stored vector dim != the query
   *  dim are skipped (stale-dim guard). */
  searchVector(query: Float32Array, k: number): SearchRow[] {
    const rows = this.db
      .query(
        "SELECT id AS chunkId, rel_path AS relPath, start_line AS startLine, end_line AS endLine, kind AS kind, text AS text, embedding FROM chunks WHERE embedding IS NOT NULL",
      )
      .all() as RawChunkRow[];
    const qNorm = norm(query);
    if (qNorm === 0) return [];
    const scored: SearchRow[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const vec = fromBlob(row.embedding);
      if (vec.length !== query.length) continue; // stale-dim guard
      const sim = cosine(query, vec, qNorm);
      scored.push({
        chunkId: row.chunkId,
        relPath: row.relPath,
        startLine: row.startLine,
        endLine: row.endLine,
        kind: row.kind,
        text: row.text,
        rank: 1 - sim, // distance: smaller is nearer
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
  allRelPaths(): string[] {
    return (
      this.db.query("SELECT DISTINCT rel_path AS r FROM chunks").all() as { r: string }[]
    ).map((x) => x.r);
  }
  hasCode(): boolean {
    return !!this.db.query("SELECT 1 AS x FROM tags LIMIT 1").get();
  }
  /** The embedder id recorded in the index header (meta table), or null if
   *  unset. "none" means the index was built lexical-only (no vectors). Used by
   *  the serve process to decide whether to load a real query embedder. Works
   *  in readonly mode — a plain SELECT, no migrate. */
  storedEmbedderId(): string | null {
    const r = this.db.query("SELECT value FROM meta WHERE key='embedderId'").get() as
      | { value: string }
      | undefined;
    return r?.value ?? null;
  }
  close(): void {
    this.db.close();
  }
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
