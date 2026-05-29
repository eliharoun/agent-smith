import { describe, expect, test } from "bun:test";
import { parsePlatformConventions } from "../../src/cli/parse-platform-conventions";

describe("parsePlatformConventions", () => {
  test("undefined → undefined", () => {
    expect(parsePlatformConventions(undefined)).toBeUndefined();
  });

  test("'accept-all' → 'accept-all'", () => {
    expect(parsePlatformConventions("accept-all")).toBe("accept-all");
  });

  test("'reject-all' → 'reject-all'", () => {
    expect(parsePlatformConventions("reject-all")).toBe("reject-all");
  });

  test("'use-defaults' → 'use-defaults'", () => {
    expect(parsePlatformConventions("use-defaults")).toBe("use-defaults");
  });

  test("'prompt' → 'prompt'", () => {
    expect(parsePlatformConventions("prompt")).toBe("prompt");
  });

  test("unknown value → throws SmithError(usage-error)", () => {
    expect(() => parsePlatformConventions("yes")).toThrow(/unknown value/i);
  });
});
