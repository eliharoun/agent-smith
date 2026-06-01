import { describe, expect, it } from "bun:test";
import { Bm25Index } from "../../../src/core/knowledge/bm25";

describe("Bm25Index", () => {
  it("ranks documents containing the query term higher than docs without it", () => {
    const ix = new Bm25Index();
    ix.addDoc("a.md", "the rain in spain falls mainly on the plain");
    ix.addDoc("b.md", "snowfall in the alps is heavy in winter");
    ix.addDoc("c.md", "deserts have very little rain or snow");
    const r = ix.search("rain", 5);
    // Both matching docs (a.md, c.md) outrank the non-matching one (b.md);
    // their relative order is determined by BM25 length normalization
    // (shorter doc wins on tf-equal terms — standard, intentional).
    const matchedPaths = r.map((h) => h.path);
    expect(matchedPaths).toContain("a.md");
    expect(matchedPaths).toContain("c.md");
    expect(matchedPaths).not.toContain("b.md");
    // Sanity: top hit is one of the matching docs, not the non-matching one.
    const top = r[0]?.path ?? "";
    expect(["a.md", "c.md"]).toContain(top);
  });

  it("returns an empty array on no matches", () => {
    const ix = new Bm25Index();
    ix.addDoc("a.md", "alpha beta gamma");
    expect(ix.search("delta")).toEqual([]);
  });

  it("includes a snippet around the highest-scoring hit", () => {
    const ix = new Bm25Index();
    ix.addDoc("a.md", "intro... and then the database connection retries once and returns ...epilogue");
    const r = ix.search("database connection", 1);
    expect(r[0]?.snippet).toMatch(/database connection/);
  });

  it("serializes and round-trips through toJSON/fromJSON", () => {
    const ix = new Bm25Index();
    ix.addDoc("a.md", "the quick brown fox");
    const json = ix.toJSON();
    const ix2 = Bm25Index.fromJSON(json);
    expect(ix2.search("quick", 1)[0]?.path).toBe("a.md");
  });
});
