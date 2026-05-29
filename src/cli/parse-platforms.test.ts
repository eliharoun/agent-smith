import { describe, expect, it } from "bun:test";
import { SmithError } from "../core/smith-error";
import { parsePlatforms } from "./parse-platforms";

describe("parsePlatforms", () => {
  it("returns undefined for undefined input", () => {
    expect(parsePlatforms(undefined)).toBeUndefined();
  });

  it("parses a single valid id", () => {
    expect(parsePlatforms("opencode")).toEqual(["opencode"]);
  });

  it("parses a csv list and trims whitespace", () => {
    expect(parsePlatforms(" opencode , codex ")).toEqual(["opencode", "codex"]);
  });

  it("dedupes repeats while preserving first-seen order", () => {
    expect(parsePlatforms("opencode,codex,opencode")).toEqual(["opencode", "codex"]);
  });

  it("throws usage-error on empty string", () => {
    expect(() => parsePlatforms("")).toThrow(SmithError);
  });

  it("throws usage-error on unknown platform", () => {
    try {
      parsePlatforms("opencode,bogus");
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SmithError);
      const se = e as SmithError;
      expect(se.code).toBe("usage-error");
      expect(se.message).toContain("bogus");
    }
  });

  it("throws usage-error on bare comma / empty entry", () => {
    expect(() => parsePlatforms("opencode,,codex")).toThrow(SmithError);
  });
});
