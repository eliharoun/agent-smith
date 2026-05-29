import { describe, expect, it } from "bun:test";
import { estimateTokens } from "../../../src/core/knowledge/tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns ~1 token for 'hi'", () => {
    expect(estimateTokens("hi")).toBeGreaterThanOrEqual(1);
    expect(estimateTokens("hi")).toBeLessThanOrEqual(2);
  });

  it("scales roughly linearly with content", () => {
    const small = estimateTokens("hello world ".repeat(10));
    const large = estimateTokens("hello world ".repeat(100));
    expect(large).toBeGreaterThan(small * 5);
    expect(large).toBeLessThan(small * 15);
  });

  it("handles unicode without throwing", () => {
    expect(() => estimateTokens("こんにちは 世界 🚀")).not.toThrow();
    expect(estimateTokens("こんにちは 世界 🚀")).toBeGreaterThan(0);
  });
});
