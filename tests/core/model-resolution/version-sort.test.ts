// tests/core/model-resolution/version-sort.test.ts
import { describe, expect, test } from "bun:test";
import { pickHighestVersion } from "../../../src/core/model-resolution/version-sort";

describe("pickHighestVersion", () => {
  test("picks numerically-largest dotted version among siblings", () => {
    expect(
      pickHighestVersion([
        "github-copilot/claude-opus-4.7",
        "github-copilot/claude-opus-4-5",
        "github-copilot/claude-opus-4.6",
      ]),
    ).toBe("github-copilot/claude-opus-4.7");
  });

  test("longer token list wins (variant > bare) at same numeric prefix", () => {
    expect(
      pickHighestVersion([
        "github-copilot/claude-opus-4.7",
        "github-copilot/claude-opus-4.7-thinking-fast",
      ]),
    ).toBe("github-copilot/claude-opus-4.7-thinking-fast");
  });

  test("extra numeric token wins over bare prefix (4.1 > 4)", () => {
    expect(
      pickHighestVersion([
        "anthropic/claude-opus-4",
        "anthropic/claude-opus-4-1",
      ]),
    ).toBe("anthropic/claude-opus-4-1");
  });

  test("non-numeric trailing tokens (e.g. preview) sort last", () => {
    expect(
      pickHighestVersion([
        "anthropic/claude-opus-preview",
        "anthropic/claude-opus-4.7",
      ]),
    ).toBe("anthropic/claude-opus-4.7");
  });

  test("provider prefix does not affect ordering — numeric version wins", () => {
    expect(
      pickHighestVersion([
        "anthropic/claude-opus-4-5",
        "github-copilot/claude-opus-4.7",
      ]),
    ).toBe("github-copilot/claude-opus-4.7");
  });

  test("single input returned verbatim", () => {
    expect(pickHighestVersion(["x/y-1.0"])).toBe("x/y-1.0");
  });

  test("empty input throws (caller must guard)", () => {
    expect(() => pickHighestVersion([])).toThrow(/at least one/i);
  });
});
