import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Embedder } from "../../../../src/core/knowledge/index/embedder";
import { hybridSearch, rrfFuse } from "../../../../src/core/knowledge/index/hybrid-search";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

describe("rrfFuse", () => {
  test("ranks items appearing in both lists above singletons", () => {
    const a = [{ chunkId: "a" }, { chunkId: "b" }, { chunkId: "c" }];
    const d = [{ chunkId: "b" }, { chunkId: "a" }, { chunkId: "x" }];
    const f = rrfFuse([a, d], (i) => i.chunkId, 60);
    expect(
      f
        .slice(0, 2)
        .map((x) => x.key)
        .sort(),
    ).toEqual(["a", "b"]);
  });
  test("single list preserves order", () => {
    expect(
      rrfFuse([[{ chunkId: "x" }, { chunkId: "y" }]], (i) => i.chunkId, 60).map((f) => f.key),
    ).toEqual(["x", "y"]);
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hsearch-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const H = {
  schemaVersion: 1,
  embedders: [
    { id: "code@1", dim: 3 },
    { id: "text@1", dim: 3 },
  ],
  chunkerVersion: 1,
  repomapVersion: 1,
};
function fake(id: string, vec: number[]): Embedder {
  return { id, dim: vec.length, embed: async () => [new Float32Array(vec)] };
}
function row(
  id: string,
  relPath: string,
  kind: "code" | "prose",
  text: string,
  vec: number[],
  embId: string,
) {
  return {
    id,
    sourceId: "s",
    relPath,
    startLine: 1,
    endLine: 2,
    kind,
    text,
    contentHash: `h-${id}`,
    vector: new Float32Array(vec),
    embedderId: embId,
    embedderDim: vec.length,
  };
}

describe("hybridSearch N dense arms + floor", () => {
  test("two models => two dense arms; a chunk appears only in its own model's arm; fused returns both", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      row("1", "a.ts", "code", "rate limiter token bucket", [1, 0, 0], "code@1"),
      row("2", "b.md", "prose", "rate limiting overview doc", [1, 0, 0], "text@1"),
    ]);
    // Query embedded identically by both models (both fakes return [1,0,0]); each
    // arm searches its own partition, so the code arm finds a.ts, text arm finds b.md.
    const hits = await hybridSearch(
      s,
      [fake("code@1", [1, 0, 0]), fake("text@1", [1, 0, 0])],
      "rate limiting",
      10,
    );
    const paths = hits.map((h) => h.relPath).sort();
    expect(paths).toEqual(["a.ts", "b.md"]);
    s.close();
  });

  test("cosine floor excludes a near-orthogonal dense hit from fusion", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    // One prose chunk whose vector is ORTHOGONAL to the query (cosine 0 < floor),
    // and its text is lexically unrelated so BM25 won't surface it either.
    await s.upsertChunks([row("1", "b.md", "prose", "zzz unrelated content", [0, 1, 0], "text@1")]);
    // Query vector [1,0,0] -> cosine with [0,1,0] is 0, below the floor.
    const hits = await hybridSearch(s, [fake("text@1", [1, 0, 0])], "something", 10);
    expect(hits.find((h) => h.relPath === "b.md")).toBeUndefined();
    s.close();
  });

  test("a dense hit ABOVE the floor still fuses in", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([row("1", "b.md", "prose", "zzz unrelated", [1, 0, 0], "text@1")]);
    // Query [1,0,0] vs stored [1,0,0] => cosine 1, well above floor.
    const hits = await hybridSearch(s, [fake("text@1", [1, 0, 0])], "anything", 10);
    expect(hits.find((h) => h.relPath === "b.md")).toBeDefined();
    s.close();
  });

  test("empty embedders array => lexical-only (no dense arm), still returns lexical hits", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([row("1", "b.md", "prose", "rate limiting overview", [1, 0, 0], "text@1")]);
    const hits = await hybridSearch(s, [], "rate limiting", 10);
    expect(hits.find((h) => h.relPath === "b.md")).toBeDefined(); // found lexically
    s.close();
  });
});
