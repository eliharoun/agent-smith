import { describe, expect, test } from "bun:test";
import { isStaleHybrid } from "../../../src/core/knowledge/stale-hybrid";

describe("isStaleHybrid", () => {
  test("hybrid + no refresh (install) + not lazy => true", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: "install", lazy: false })).toBe(true);
  });
  test("hybrid + undefined refresh (defaults to install) => true", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: undefined, lazy: false })).toBe(true);
  });
  test("hybrid + ttl => false", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: "ttl", lazy: false })).toBe(false);
  });
  test("hybrid + session => false", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: "session", lazy: false })).toBe(false);
  });
  test("hybrid + always => false", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: "always", lazy: false })).toBe(false);
  });
  test("lazy hybrid => false (never indexed, retrieval is inert)", () => {
    expect(isStaleHybrid({ retrievalMode: "hybrid", refreshMode: "install", lazy: true })).toBe(false);
  });
  test("bm25 + install => false (no embeddings to go stale)", () => {
    expect(isStaleHybrid({ retrievalMode: "bm25", refreshMode: "install", lazy: false })).toBe(false);
  });
  test("off => false", () => {
    expect(isStaleHybrid({ retrievalMode: "off", refreshMode: "install", lazy: false })).toBe(false);
  });
  test("external-mcp + install => false (non-hybrid mode)", () => {
    expect(isStaleHybrid({ retrievalMode: "external-mcp", refreshMode: "install", lazy: false })).toBe(false);
  });
  test("undefined retrieval => false (treated as non-hybrid)", () => {
    expect(isStaleHybrid({ retrievalMode: undefined, refreshMode: "install", lazy: false })).toBe(false);
  });
});
