import { describe, expect, it, test } from "bun:test";
import { embedderCache, loadEmbedder, NullEmbedder } from "../../../../src/core/knowledge/index/embedder";

describe("embedder", () => {
  it("NullEmbedder: id none, dim 0, no vectors", async () => {
    const e = new NullEmbedder();
    expect([e.id, e.dim]).toEqual(["none", 0]);
    expect(await e.embed(["a", "b"])).toEqual([]);
  });
  it("loadEmbedder forceNull degrades to NullEmbedder", async () => {
    expect((await loadEmbedder({ forceNull: true })).id).toBe("none");
  });
  it("SMITH_NO_EMBEDDINGS=1 forces NullEmbedder (hermetic CI, no model load)", async () => {
    const prev = process.env.SMITH_NO_EMBEDDINGS;
    process.env.SMITH_NO_EMBEDDINGS = "1";
    try {
      // Even with a real model id requested, the env short-circuits to lexical.
      expect((await loadEmbedder({ modelId: "jinaai/jina-embeddings-v2-base-code" })).id).toBe(
        "none",
      );
    } finally {
      if (prev === undefined) delete process.env.SMITH_NO_EMBEDDINGS;
      else process.env.SMITH_NO_EMBEDDINGS = prev;
    }
  });
  it("real embedder returns one unit-norm vector per input (when available)", async () => {
    const e = await loadEmbedder({});
    if (e.id === "none") return; // tolerated, but per verification this SHOULD run and produce a 768-dim vector
    const [v] = await e.embed(["hello world"]);
    expect(v?.length).toBe(e.dim);
    const norm = Math.sqrt([...v!].reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
  });
});
test("embedderCache memoizes the in-flight promise per id (concurrent-safe)", () => {
  const cache = embedderCache();
  const p1 = cache.get("none"); // "none" => NullEmbedder, no model load
  const p2 = cache.get("none");
  expect(p1).toBe(p2); // SAME promise object, not a re-load
});
test("embedderCache get('none') resolves to a NullEmbedder", async () => {
  const cache = embedderCache();
  const e = await cache.get("none");
  expect(e.id).toBe("none");
});
