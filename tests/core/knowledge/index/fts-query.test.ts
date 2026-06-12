import { describe, expect, it } from "bun:test";
import { ftsTokens } from "../../../../src/core/knowledge/index/fts-query";

describe("ftsTokens", () => {
  it("splits on non-alphanumerics, drops <2 char tokens", () => {
    expect(ftsTokens("rate-limiting in the gateway:foo")).toEqual([
      "rate",
      "limiting",
      "in",
      "the",
      "gateway",
      "foo",
    ]);
  });
  it("returns [] for punctuation-only input (no FTS syntax leaks)", () => {
    expect(ftsTokens('":*()')).toEqual([]);
  });
});
