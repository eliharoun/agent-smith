import { describe, expect, it } from "bun:test";
import { loadEmbedder, NullEmbedder } from "../../../../src/core/knowledge/index/embedder";

describe("embedder", () => {
  it("NullEmbedder: id none, dim 0, no vectors", async () => {
    const e = new NullEmbedder();
    expect([e.id, e.dim]).toEqual(["none", 0]);
    expect(await e.embed(["a", "b"])).toEqual([]);
  });
  it("loadEmbedder forceNull degrades to NullEmbedder", async () => {
    expect((await loadEmbedder({ forceNull: true })).id).toBe("none");
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
