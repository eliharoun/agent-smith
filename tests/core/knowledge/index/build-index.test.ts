import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../../../../src/core/knowledge/index/build-index";
import type { Embedder, EmbedderCache } from "../../../../src/core/knowledge/index/embedder";
import { explainSearch, hybridSearch } from "../../../../src/core/knowledge/index/hybrid-search";
import { CODE_MODEL, TEXT_MODEL } from "../../../../src/core/knowledge/index/model-policy";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kbuild-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const H = (embId: string, dim: number) => ({
  schemaVersion: 1,
  embedders: embId === "none" ? [] : [{ id: embId, dim }],
  chunkerVersion: 1,
  modelPolicyVersion: 1,
  repomapVersion: 1,
});
const fakeEmb = (dim: number): Embedder => ({
  id: "fake@1",
  dim,
  async embed(ts: string[]) {
    return ts.map(() => Float32Array.from({ length: dim }, () => 0.5));
  },
});
// A cache whose get(modelId) returns a fake embedder stamped `${modelId}@1`
// (matching ModelRef.id), so routed chunks are stamped with the policy ids.
// `requested` records every modelId asked for (proves the lazy-per-kind path).
const fakeCache = (
  dim: number,
): { cache: EmbedderCache; requested: string[] } => {
  const requested: string[] = [];
  const cache: EmbedderCache = {
    async get(modelId: string): Promise<Embedder> {
      requested.push(modelId);
      return {
        id: `${modelId}@1`,
        dim,
        async embed(ts: string[]) {
          return ts.map(() => Float32Array.from({ length: dim }, () => 0.5));
        },
      };
    },
  };
  return { cache, requested };
};
// A single-id cache that always returns `fakeEmb(dim)` (id "fake@1"), used to
// migrate the legacy single-embedder tests to the cache shape.
const singleCache = (dim: number): EmbedderCache => ({
  async get(): Promise<Embedder> {
    return fakeEmb(dim);
  },
});

describe("buildIndex", () => {
  test("reindex with FEWER chunks leaves no orphans (5 headings -> 1)", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "s"), { recursive: true });
    const rel = "sources/s/big.md";
    // 5 markdown sections -> 5 prose chunks, each with a unique term.
    await writeFile(
      join(kd, rel),
      "# one\nuniqalpha\n# two\nuniqbeta\n# three\nuniqgamma\n# four\nuniqdelta\n# five\nuniqepsilon\n",
    );
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("none", 1));
    if (!store) return;
    await buildIndex({ knowledgeDir: kd, store, embedders: null, changedPaths: null });
    expect(store.searchLexical(["uniqepsilon"], 5).length).toBe(1); // section 5 indexed

    // Rewrite to a single tiny section -> 1 chunk. The 4 old chunks must vanish.
    await writeFile(join(kd, rel), "# only\nuniqomega\n");
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: null,
      changedPaths: [rel],
    });
    expect(store.searchLexical(["uniqomega"], 5).length).toBe(1); // new content present
    for (const stale of ["uniqalpha", "uniqbeta", "uniqgamma", "uniqdelta", "uniqepsilon"]) {
      expect(store.searchLexical([stale], 5)).toEqual([]); // no orphaned chunks
    }
    store.close();
  });

  test("indexes materialized files; lexical finds them", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "s"), { recursive: true });
    await writeFile(join(kd, "sources", "s", "doc.md"), "# T\nrate limiting here\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("none", 1));
    if (!store) return;
    await buildIndex({ knowledgeDir: kd, store, embedders: null, changedPaths: null });
    expect(store.searchLexical(["rate", "limiting"], 5)[0]?.relPath).toContain("doc.md");
    store.close();
  });

  test("incremental: only changed paths reindexed; others untouched", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "s"), { recursive: true });
    await writeFile(join(kd, "sources", "s", "a.md"), "alpha\n");
    await writeFile(join(kd, "sources", "s", "b.md"), "beta\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("none", 1));
    if (!store) return;
    await buildIndex({ knowledgeDir: kd, store, embedders: null, changedPaths: null });
    await writeFile(join(kd, "sources", "s", "a.md"), "alpha gamma\n");
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: null,
      changedPaths: ["sources/s/a.md"],
    });
    expect(store.searchLexical(["gamma"], 5)[0]?.relPath).toContain("a.md");
    expect(store.searchLexical(["beta"], 5).length).toBe(1);
    store.close();
  });

  test("embedder-aware: files unembedded earlier get vectors when embedder arrives", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "s"), { recursive: true });
    await writeFile(join(kd, "sources", "s", "a.md"), "alpha\n");
    const p = join(kd, ".cache", "index", "k.db");
    const s1 = await KnowledgeStore.open(p, H("none", 1));
    if (!s1) return;
    await buildIndex({
      knowledgeDir: kd,
      store: s1,
      embedders: null,
      changedPaths: null,
    });
    expect(s1.hasVector("sources/s/a.md")).toBe(false);
    s1.close();
    const s2 = await KnowledgeStore.open(p, H("fake@1", 4));
    await buildIndex({
      knowledgeDir: kd,
      store: s2!,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(["s"]),
    });
    expect(s2!.hasVector("sources/s/a.md")).toBe(true);
    s2!.close();
  });

  test("embeds ONLY hybrid sources' chunks; non-hybrid stay vector-less", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await mkdir(join(kd, "sources", "lex"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.md"), "alpha hybrid content\n");
    await writeFile(join(kd, "sources", "lex", "b.md"), "beta lexical content\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("fake@1", 4));
    if (!store) return;
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(store.hasVector("sources/hy/a.md")).toBe(true); // hybrid → embedded
    expect(store.hasVector("sources/lex/b.md")).toBe(false); // non-hybrid → no vector
    // both are still lexically searchable regardless
    expect(store.searchLexical(["alpha"], 5).length).toBe(1);
    expect(store.searchLexical(["beta"], 5).length).toBe(1);
    store.close();
  });

  test("no hybridSourceIds → nothing embedded even with a real embedder", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "s"), { recursive: true });
    await writeFile(join(kd, "sources", "s", "a.md"), "alpha\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("fake@1", 4));
    if (!store) return;
    await buildIndex({ knowledgeDir: kd, store, embedders: singleCache(4), changedPaths: null }); // no hybridSourceIds
    expect(store.hasVector("sources/s/a.md")).toBe(false);
    store.close();
  });

  test("flipping a source OFF hybrid clears its orphan vectors on full rebuild", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.md"), "alpha\n");
    const p = join(kd, ".cache", "index", "k.db");
    const s1 = await KnowledgeStore.open(p, H("fake@1", 4));
    if (!s1) return;
    await buildIndex({
      knowledgeDir: kd,
      store: s1,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(s1.hasVector("sources/hy/a.md")).toBe(true);
    // Full rebuild, same content, but source no longer hybrid:
    await buildIndex({
      knowledgeDir: kd,
      store: s1,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(),
    });
    expect(s1.hasVector("sources/hy/a.md")).toBe(false); // orphan vector cleared
    expect(s1.searchLexical(["alpha"], 5).length).toBe(1); // lexical still works
    s1.close();
  });

  test("embedded chunks are stamped with the embedder's id (storedEmbedderIds sees it)", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.md"), "alpha hybrid content\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), H("fake@1", 4));
    if (!store) return;
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    // The embedded chunk carries the running model's id (not NULL), so:
    expect(store.hasVectorFor("sources/hy/a.md", "fake@1")).toBe(true);
    // ...and the index's derived model identity reflects that id.
    expect(store.storedEmbedderIds().map((m) => m.id)).toContain("fake@1");
    store.close();
  });

  test("a hybrid file lacking a vector gets re-embedded on rebuild (embedder-aware skip)", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.md"), "alpha\n");
    const p = join(kd, ".cache", "index", "k.db");
    // First build: treat as NON-hybrid (no vectors).
    const s1 = await KnowledgeStore.open(p, H("fake@1", 4));
    if (!s1) return;
    await buildIndex({
      knowledgeDir: kd,
      store: s1,
      embedders: null,
      changedPaths: null,
      hybridSourceIds: new Set(),
    });
    expect(s1.hasVector("sources/hy/a.md")).toBe(false);
    s1.close();
    // Second build: now hybrid — same content, but must re-embed (not skip).
    const s2 = await KnowledgeStore.open(p, H("fake@1", 4));
    await buildIndex({
      knowledgeDir: kd,
      store: s2!,
      embedders: singleCache(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(s2!.hasVector("sources/hy/a.md")).toBe(true);
    s2!.close();
  });

  test("routes code chunks to the code model and prose chunks to the text model", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.ts"), "export function foo(){return 1}\n");
    await writeFile(join(kd, "sources", "hy", "b.md"), "# T\nprose content here\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), {
      schemaVersion: 1,
      embedders: [
        { id: CODE_MODEL.id, dim: 4 },
        { id: TEXT_MODEL.id, dim: 4 },
      ],
      chunkerVersion: 1,
      modelPolicyVersion: 1,
      repomapVersion: 1,
    });
    if (!store) return;
    const { cache } = fakeCache(4);
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: cache,
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(store.hasVectorFor("sources/hy/a.ts", CODE_MODEL.id)).toBe(true);
    expect(store.hasVectorFor("sources/hy/b.md", TEXT_MODEL.id)).toBe(true);
    // a.ts is code-only — it must NOT carry a text-model vector.
    expect(store.hasVectorFor("sources/hy/a.ts", TEXT_MODEL.id)).toBe(false);
    store.close();
  });

  test("end-to-end: per-kind routing → hybridSearch returns both arms, explain shows per-role provenance", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    // A real code file (→ code model) and a real prose file (→ text model).
    await writeFile(join(kd, "sources", "hy", "a.ts"), "export function rateLimiter(){return 1}\n");
    await writeFile(join(kd, "sources", "hy", "b.md"), "# Overview\nrate limiting prose content\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), {
      schemaVersion: 1,
      embedders: [
        { id: CODE_MODEL.id, dim: 4 },
        { id: TEXT_MODEL.id, dim: 4 },
      ],
      chunkerVersion: 1,
      modelPolicyVersion: 1,
      repomapVersion: 1,
    });
    if (!store) return;
    // Build with a per-kind fake cache: every routed chunk is embedded to a
    // fixed vector [1,0,0,0] and stamped with the policy id (`${modelId}@1`).
    const { cache } = fakeCache(4);
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: cache,
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });

    // Search-side fakes: same ids as the stamped rows, same query vector, so
    // searchVector(qv, k, id) yields cosine=1 (> SIM_FLOOR) in each partition.
    const fakeFor = (id: string): Embedder => ({
      id,
      dim: 4,
      async embed(ts: string[]) {
        return ts.map(() => Float32Array.from([1, 0, 0, 0]));
      },
    });
    const searchEmbs = [fakeFor(CODE_MODEL.id), fakeFor(TEXT_MODEL.id)];

    // hybridSearch surfaces BOTH the code file (code arm) and the prose file (text arm).
    const hits = await hybridSearch(store, searchEmbs, "rate limiting", 10);
    const paths = hits.map((h) => h.relPath).sort();
    expect(paths).toContain("sources/hy/a.ts");
    expect(paths).toContain("sources/hy/b.md");

    // explainSearch exposes one dense arm per model id, each carrying its own file.
    const ex = await explainSearch(store, searchEmbs, "rate limiting", 10);
    expect(ex.hybrid).toBe(true);
    expect(Object.keys(ex.vectors).sort()).toEqual([CODE_MODEL.id, TEXT_MODEL.id].sort());
    expect(ex.vectors[CODE_MODEL.id]?.map((v) => v.relPath)).toContain("sources/hy/a.ts");
    expect(ex.vectors[TEXT_MODEL.id]?.map((v) => v.relPath)).toContain("sources/hy/b.md");

    // A fused entry carries the right per-model rank: the .ts ranks in the code
    // arm (and is absent from the text arm), and vice-versa for the .md.
    const codeEntry = ex.fused.find((f) => f.relPath === "sources/hy/a.ts");
    const proseEntry = ex.fused.find((f) => f.relPath === "sources/hy/b.md");
    expect(codeEntry?.vectorRanks[CODE_MODEL.id]).toBe(1);
    expect(codeEntry?.vectorRanks[TEXT_MODEL.id]).toBeNull();
    expect(proseEntry?.vectorRanks[TEXT_MODEL.id]).toBe(1);
    expect(proseEntry?.vectorRanks[CODE_MODEL.id]).toBeNull();
    store.close();
  });

  test("does NOT load the text model for a code-only hybrid source (lazy per-kind)", async () => {
    const kd = join(dir, "knowledge");
    await mkdir(join(kd, "sources", "hy"), { recursive: true });
    await writeFile(join(kd, "sources", "hy", "a.ts"), "export function foo(){return 1}\n");
    const store = await KnowledgeStore.open(join(kd, ".cache", "index", "k.db"), {
      schemaVersion: 1,
      embedders: [
        { id: CODE_MODEL.id, dim: 4 },
        { id: TEXT_MODEL.id, dim: 4 },
      ],
      chunkerVersion: 1,
      modelPolicyVersion: 1,
      repomapVersion: 1,
    });
    if (!store) return;
    const { cache, requested } = fakeCache(4);
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedders: cache,
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(requested).toContain(CODE_MODEL.modelId);
    expect(requested).not.toContain(TEXT_MODEL.modelId); // text model never requested
    store.close();
  });
});
