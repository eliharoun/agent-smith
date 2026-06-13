import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../../../../src/core/knowledge/index/build-index";
import { NullEmbedder } from "../../../../src/core/knowledge/index/embedder";
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
  embedderId: embId,
  embedderDim: dim,
  chunkerVersion: 1,
  repomapVersion: 1,
});
const fakeEmb = (dim: number) => ({
  id: "fake@1",
  dim,
  async embed(ts: string[]) {
    return ts.map(() => Float32Array.from({ length: dim }, () => 0.5));
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
    await buildIndex({ knowledgeDir: kd, store, embedder: new NullEmbedder(), changedPaths: null });
    expect(store.searchLexical(["uniqepsilon"], 5).length).toBe(1); // section 5 indexed

    // Rewrite to a single tiny section -> 1 chunk. The 4 old chunks must vanish.
    await writeFile(join(kd, rel), "# only\nuniqomega\n");
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedder: new NullEmbedder(),
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
    await buildIndex({ knowledgeDir: kd, store, embedder: new NullEmbedder(), changedPaths: null });
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
    await buildIndex({ knowledgeDir: kd, store, embedder: new NullEmbedder(), changedPaths: null });
    await writeFile(join(kd, "sources", "s", "a.md"), "alpha gamma\n");
    await buildIndex({
      knowledgeDir: kd,
      store,
      embedder: new NullEmbedder(),
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
      embedder: new NullEmbedder(),
      changedPaths: null,
    });
    expect(s1.hasVector("sources/s/a.md")).toBe(false);
    s1.close();
    const s2 = await KnowledgeStore.open(p, H("fake@1", 4));
    await buildIndex({
      knowledgeDir: kd,
      store: s2!,
      embedder: fakeEmb(4),
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
      embedder: fakeEmb(4),
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
    await buildIndex({ knowledgeDir: kd, store, embedder: fakeEmb(4), changedPaths: null }); // no hybridSourceIds
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
      embedder: fakeEmb(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(s1.hasVector("sources/hy/a.md")).toBe(true);
    // Full rebuild, same content, but source no longer hybrid:
    await buildIndex({
      knowledgeDir: kd,
      store: s1,
      embedder: fakeEmb(4),
      changedPaths: null,
      hybridSourceIds: new Set(),
    });
    expect(s1.hasVector("sources/hy/a.md")).toBe(false); // orphan vector cleared
    expect(s1.searchLexical(["alpha"], 5).length).toBe(1); // lexical still works
    s1.close();
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
      embedder: fakeEmb(4),
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
      embedder: fakeEmb(4),
      changedPaths: null,
      hybridSourceIds: new Set(["hy"]),
    });
    expect(s2!.hasVector("sources/hy/a.md")).toBe(true);
    s2!.close();
  });
});
