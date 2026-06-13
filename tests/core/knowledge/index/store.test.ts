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
  embedderId: "emb-a",
  embedderDim: 3,
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
      },
    ]);
    expect(s.searchVector(new Float32Array([0.9, 0.1, 0]), 1)[0]?.relPath).toBe("a.md");
    s.close();
  });

  test("changing embedderId+dim DROPS and recreates vec at new width", async () => {
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
      },
    ]);
    s1.close();
    const s2 = await KnowledgeStore.open(p, { ...H, embedderId: "emb-b", embedderDim: 4 });
    expect(s2).not.toBeNull();
    expect(s2!.searchVector(new Float32Array([1, 0, 0, 0]), 1)).toEqual([]);
    s2!.close();
  });

  test("transient embedderId='none' does NOT wipe existing vectors", async () => {
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
      },
    ]);
    s1.close();
    const sNone = await KnowledgeStore.open(p, { ...H, embedderId: "none", embedderDim: 1 });
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

  test("a lexical-only (none) reopen does NOT overwrite a real recorded embedderId", async () => {
    const p = join(dir, "k.db");
    const s1 = await KnowledgeStore.open(p, { ...H, embedderId: "real-model@1", embedderDim: 4 });
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
      },
    ]);
    s1.close();
    // Reopen as lexical-only (NullEmbedder id "none") — simulates a lexical-source refresh.
    const s2 = await KnowledgeStore.open(p, { ...H, embedderId: "none", embedderDim: 1 });
    expect(s2).not.toBeNull();
    expect(s2!.storedEmbedderId()).toBe("real-model@1"); // NOT clobbered to "none"
    expect(s2!.hasVector("sources/hy/a.md")).toBe(true); // vectors preserved
    s2!.close();
  });

  test("first-ever lexical build records embedderId 'none'", async () => {
    const s = await KnowledgeStore.open(join(dir, "k2.db"), {
      ...H,
      embedderId: "none",
      embedderDim: 1,
    });
    if (!s) return;
    expect(s.storedEmbedderId()).toBe("none");
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
      },
    ]);
    const hits = s.searchVector(new Float32Array([1, 0, 0]), 2);
    expect(hits.map((h) => h.relPath)).toEqual(["near.md", "mid.md"]); // far.md excluded by k=2
    expect(hits[0]!.rank).toBeLessThanOrEqual(hits[1]!.rank); // ascending distance
    s.close();
  });
});
