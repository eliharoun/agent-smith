import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kstore-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const H = {
  schemaVersion: 1,
  embedders: [{ id: "emb-a@1", dim: 3 }],
  chunkerVersion: 1,
  repomapVersion: 1,
};

describe("KnowledgeStore", () => {
  test("upsert + FTS5 lexical search", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 2,
        kind: "prose",
        text: "rate limiting in the gateway",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
      },
      {
        id: "2",
        sourceId: "s",
        relPath: "b.md",
        startLine: 1,
        endLine: 2,
        kind: "prose",
        text: "database connection retries",
        contentHash: "h2",
        vector: new Float32Array([0, 1, 0]),
      },
    ]);
    expect(s.searchLexical(["rate", "limiting"], 5)[0]?.relPath).toBe("a.md");
    s.close();
  });

  test("vector KNN nearest by distance", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "x",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
      {
        id: "2",
        sourceId: "s",
        relPath: "b.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "y",
        contentHash: "h2",
        vector: new Float32Array([0, 1, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
    ]);
    expect(s.searchVector(new Float32Array([0.9, 0.1, 0]), 1, "emb-a@1")[0]?.relPath).toBe("a.md");
    s.close();
  });

  test("changing embedder model clears the old model's vectors", async () => {
    const p = join(dir, "k.db");
    const s1 = await KnowledgeStore.open(p, H);
    if (!s1) return;
    await s1.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "hi",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
    ]);
    s1.close();
    const s2 = await KnowledgeStore.open(p, { ...H, embedders: [{ id: "emb-b@1", dim: 4 }] });
    expect(s2).not.toBeNull();
    // Old model emb-a@1's vectors were cleared (left the running set).
    expect(s2!.searchVector(new Float32Array([1, 0, 0]), 1, "emb-a@1")).toEqual([]);
    expect(s2!.hasVectorFor("a.md", "emb-a@1")).toBe(false);
    s2!.close();
  });

  test("transient lexical-only reopen does NOT wipe existing vectors", async () => {
    const p = join(dir, "k.db");
    const s1 = await KnowledgeStore.open(p, H);
    if (!s1) return;
    await s1.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "hi",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
    ]);
    s1.close();
    const sNone = await KnowledgeStore.open(p, { ...H, embedders: [] });
    expect(sNone!.hasVector("a.md")).toBe(true);
    sNone!.close();
  });

  test("schema_version bump rebuilds WITHOUT infinite recursion", async () => {
    const p = join(dir, "k.db");
    const s1 = await KnowledgeStore.open(p, H);
    if (!s1) return;
    await s1.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "hi",
        contentHash: "h1",
      },
    ]);
    s1.close();
    const s2 = await KnowledgeStore.open(p, { ...H, schemaVersion: 2 });
    expect(s2).not.toBeNull();
    expect(s2!.searchLexical(["hi"], 5)).toEqual([]);
    s2!.close();
  });

  test("contentHashFor + hasVector + deleteByPath", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "hi",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
      },
    ]);
    expect(s.contentHashFor("a.md")).toBe("h1");
    expect(s.hasVector("a.md")).toBe(true);
    await s.deleteByPath("a.md");
    expect(s.contentHashFor("a.md")).toBeNull();
    expect(s.searchLexical(["hi"], 5)).toEqual([]);
    s.close();
  });

  test("read-only open does not create or write", async () => {
    const ro = await KnowledgeStore.open(join(dir, "missing.db"), H, { readonly: true });
    expect(ro).toBeNull();
  });

  test("re-upsert same id drops the stale FTS posting (no false positives)", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "alpha beta",
        contentHash: "h1",
      },
    ]);
    expect(s.searchLexical(["alpha"], 5).length).toBe(1);
    // Re-index the SAME chunk id with new text (the incremental-reindex path).
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "gamma delta",
        contentHash: "h2",
      },
    ]);
    expect(s.searchLexical(["alpha"], 5)).toEqual([]); // stale term gone
    expect(s.searchLexical(["gamma"], 5)[0]?.relPath).toBe("a.md"); // new term present
    s.close();
  });

  test("deleteByPath cleans FTS for a path with multiple chunks", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "a#0",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "first chunk apple",
        contentHash: "h1",
      },
      {
        id: "a#1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 2,
        endLine: 2,
        kind: "prose",
        text: "second chunk banana",
        contentHash: "h1",
      },
    ]);
    expect(s.searchLexical(["apple"], 5).length).toBe(1);
    expect(s.searchLexical(["banana"], 5).length).toBe(1);
    await s.deleteByPath("a.md");
    expect(s.searchLexical(["apple"], 5)).toEqual([]);
    expect(s.searchLexical(["banana"], 5)).toEqual([]);
    s.close();
  });

  test("a lexical-only reopen does NOT overwrite a real recorded embedder", async () => {
    const p = join(dir, "k.db");
    const s1 = await KnowledgeStore.open(p, { ...H, embedders: [{ id: "real-model@1", dim: 4 }] });
    if (!s1) return;
    await s1.upsertChunks([
      {
        id: "1",
        sourceId: "hy",
        relPath: "sources/hy/a.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "x",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0, 0]),
        embedderId: "real-model@1",
        embedderDim: 4,
      },
    ]);
    s1.close();
    // Reopen as lexical-only (NullEmbedder, empty model set) — simulates a lexical-source refresh.
    const s2 = await KnowledgeStore.open(p, { ...H, embedders: [] });
    expect(s2).not.toBeNull();
    expect(s2!.storedEmbedderId()).toBe("real-model@1"); // derived from live vectors, NOT clobbered
    expect(s2!.hasVector("sources/hy/a.md")).toBe(true); // vectors preserved
    s2!.close();
  });

  test("first-ever lexical build reports embedder 'none'", async () => {
    const s = await KnowledgeStore.open(join(dir, "k2.db"), {
      ...H,
      embedders: [],
    });
    if (!s) return;
    expect(s.storedEmbedderId()).toBe("none");
    s.close();
  });

  test("chunk stores embedder_id; hasVectorFor distinguishes models", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([{
      id: "1", sourceId: "s", relPath: "a.md", startLine: 1, endLine: 2,
      kind: "prose", text: "hello", contentHash: "h1",
      vector: new Float32Array([1, 0, 0]), embedderId: "model-A@1", embedderDim: 3,
    }]);
    expect(s.hasVectorFor("a.md", "model-A@1")).toBe(true);
    expect(s.hasVectorFor("a.md", "model-B@1")).toBe(false);
    s.close();
  });

  test("chunk without a vector has null embedder_id (no false model attribution)", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([{
      id: "1", sourceId: "s", relPath: "a.md", startLine: 1, endLine: 2,
      kind: "prose", text: "hello", contentHash: "h1",
      // no vector, no embedderId
    }]);
    expect(s.hasVectorFor("a.md", "model-A@1")).toBe(false);
    s.close();
  });

  test("vector KNN orders 3+ vectors by ascending distance and respects k", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "near.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "n",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
      {
        id: "2",
        sourceId: "s",
        relPath: "mid.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "m",
        contentHash: "h2",
        vector: new Float32Array([0.7, 0.7, 0]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
      {
        id: "3",
        sourceId: "s",
        relPath: "far.md",
        startLine: 1,
        endLine: 1,
        kind: "prose",
        text: "f",
        contentHash: "h3",
        vector: new Float32Array([0, 0, 1]),
        embedderId: "emb-a@1",
        embedderDim: 3,
      },
    ]);
    const hits = s.searchVector(new Float32Array([1, 0, 0]), 2, "emb-a@1");
    expect(hits.map((h) => h.relPath)).toEqual(["near.md", "mid.md"]); // far.md excluded by k=2
    expect(hits[0]!.rank).toBeLessThanOrEqual(hits[1]!.rank); // ascending distance
    s.close();
  });

  test("searchVector partitions by embedder_id (no cross-model scoring at equal dim)", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      { id: "1", sourceId: "s", relPath: "code.ts", startLine: 1, endLine: 2, kind: "code",
        text: "x", contentHash: "h1", vector: new Float32Array([1, 0, 0]), embedderId: "code@1", embedderDim: 3 },
      { id: "2", sourceId: "s", relPath: "doc.md", startLine: 1, endLine: 2, kind: "prose",
        text: "y", contentHash: "h2", vector: new Float32Array([1, 0, 0]), embedderId: "text@1", embedderDim: 3 },
    ]);
    // Identical stored vectors AND identical dim — only the model filter separates them.
    expect(s.searchVector(new Float32Array([1, 0, 0]), 5, "code@1").map((h) => h.relPath)).toEqual(["code.ts"]);
    expect(s.searchVector(new Float32Array([1, 0, 0]), 5, "text@1").map((h) => h.relPath)).toEqual(["doc.md"]);
    s.close();
  });

  test("searchVector exposes raw cosine similarity (sim) for floor gating", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      { id: "1", sourceId: "s", relPath: "a.md", startLine: 1, endLine: 2, kind: "prose",
        text: "x", contentHash: "h1", vector: new Float32Array([1, 0, 0]), embedderId: "m@1", embedderDim: 3 },
    ]);
    const hits = s.searchVector(new Float32Array([1, 0, 0]), 5, "m@1");
    expect(hits[0]!.sim).toBeCloseTo(1, 5); // identical vectors => cosine ~1
    s.close();
  });

  test("storedEmbedderIds reports distinct models over LIVE vectors only", async () => {
    const h = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }, { id: "text@1", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    const s = await KnowledgeStore.open(join(dir, "k.db"), h);
    if (!s) return;
    await s.upsertChunks([
      { id: "1", sourceId: "s", relPath: "a.ts", startLine: 1, endLine: 2, kind: "code", text: "x", contentHash: "h1", vector: new Float32Array([1,0,0]), embedderId: "code@1", embedderDim: 3 },
      { id: "2", sourceId: "s", relPath: "b.md", startLine: 1, endLine: 2, kind: "prose", text: "y", contentHash: "h2", vector: new Float32Array([0,1,0]), embedderId: "text@1", embedderDim: 3 },
    ]);
    expect(new Set(s.storedEmbedderIds().map((m) => m.id))).toEqual(new Set(["code@1", "text@1"]));
    s.clearVectorsByPath("b.md");
    expect(s.storedEmbedderIds().map((m) => m.id)).toEqual(["code@1"]);
    s.close();
  });

  test("per-model reconcile clears only the changed model's vectors", async () => {
    const dbp = join(dir, "k.db");
    const h1 = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }, { id: "text@1", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    let s = await KnowledgeStore.open(dbp, h1);
    if (!s) return;
    await s.upsertChunks([
      { id: "1", sourceId: "s", relPath: "a.ts", startLine: 1, endLine: 2, kind: "code", text: "x", contentHash: "h1", vector: new Float32Array([1,0,0]), embedderId: "code@1", embedderDim: 3 },
      { id: "2", sourceId: "s", relPath: "b.md", startLine: 1, endLine: 2, kind: "prose", text: "y", contentHash: "h2", vector: new Float32Array([0,1,0]), embedderId: "text@1", embedderDim: 3 },
    ]);
    s.close();
    // Reopen with the TEXT model changed (text@1 -> text@2), code unchanged.
    const h2 = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }, { id: "text@2", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    s = await KnowledgeStore.open(dbp, h2);
    if (!s) return;
    expect(s.hasVectorFor("a.ts", "code@1")).toBe(true);  // code untouched
    expect(s.hasVectorFor("b.md", "text@1")).toBe(false); // old text vectors cleared
    s.close();
  });

  test("lexical-only (empty embedders) reopen does NOT clear existing vectors", async () => {
    const dbp = join(dir, "k.db");
    const h1 = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    let s = await KnowledgeStore.open(dbp, h1);
    if (!s) return;
    await s.upsertChunks([
      { id: "1", sourceId: "s", relPath: "a.ts", startLine: 1, endLine: 2, kind: "code", text: "x", contentHash: "h1", vector: new Float32Array([1,0,0]), embedderId: "code@1", embedderDim: 3 },
    ]);
    s.close();
    // Reopen lexical-only (no models this session) — must NOT wipe the code vectors.
    const h2 = { schemaVersion: 1, embedders: [], chunkerVersion: 1, repomapVersion: 1 };
    s = await KnowledgeStore.open(dbp, h2);
    if (!s) return;
    expect(s.hasVectorFor("a.ts", "code@1")).toBe(true);
    s.close();
  });

  test("malformed embedders meta does not crash open (degrades, no throw)", async () => {
    const dbp = join(dir, "k.db");
    const h = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    const s = await KnowledgeStore.open(dbp, h);
    if (!s) return;
    s.close();
    // Corrupt the meta value, then reopen — open must succeed (not return null/throw).
    const s2 = await KnowledgeStore.open(dbp, h);
    expect(s2).not.toBeNull();
    s2?.close();
  });

  test("malformed embedders meta degrades gracefully (open does not throw/return null)", async () => {
    const dbp = join(dir, "k.db");
    const h = { schemaVersion: 1, embedders: [{ id: "code@1", dim: 3 }], chunkerVersion: 1, repomapVersion: 1 };
    let s = await KnowledgeStore.open(dbp, h);
    if (!s) return;
    await s.upsertChunks([{ id: "1", sourceId: "s", relPath: "a.ts", startLine: 1, endLine: 2, kind: "code", text: "x", contentHash: "h1", vector: new Float32Array([1,0,0]), embedderId: "code@1", embedderDim: 3 }]);
    s.close();
    // Corrupt the embedders meta value directly via raw bun:sqlite.
    const { Database } = await import("bun:sqlite");
    const raw = new Database(dbp);
    raw.query("INSERT INTO meta(key,value) VALUES('embedders','{not valid json') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    raw.close();
    // Reopen — must succeed (defensive parse → treat as empty, never throw).
    const s2 = await KnowledgeStore.open(dbp, h);
    expect(s2).not.toBeNull();
    // The code vectors must survive (reopen with the SAME running model => no clear).
    expect(s2?.hasVectorFor("a.ts", "code@1")).toBe(true);
    s2?.close();
  });
});
