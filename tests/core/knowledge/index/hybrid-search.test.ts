import { describe, expect, it } from "bun:test";
import { rrfFuse } from "../../../../src/core/knowledge/index/hybrid-search";

describe("rrfFuse", () => {
  it("ranks items appearing in both lists above singletons", () => {
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
  it("single list preserves order", () => {
    expect(
      rrfFuse([[{ chunkId: "x" }, { chunkId: "y" }]], (i) => i.chunkId, 60).map((f) => f.key),
    ).toEqual(["x", "y"]);
  });
});
