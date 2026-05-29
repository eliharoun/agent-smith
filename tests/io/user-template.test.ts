// Tests for the canonical USER.md template constant.
//
// Locks the contract downstream readers depend on (architect skill's
// USER.md sniffer, doctor's stub-detection): the seeded file must
// start with `# About me`. Without this test, a future contributor
// could rephrase the template to something like `## About you` and
// silently break the architect skill's heuristic for "is this a
// fresh stub or real user content?".

import { describe, expect, test } from "bun:test";
import { CANONICAL_USER_MD_TEMPLATE } from "../../src/io/user-template";

describe("CANONICAL_USER_MD_TEMPLATE", () => {
  test("starts with '# About me' heading", () => {
    expect(CANONICAL_USER_MD_TEMPLATE.startsWith("# About me\n")).toBe(true);
  });

  test("ends with a trailing newline", () => {
    expect(CANONICAL_USER_MD_TEMPLATE.endsWith("\n")).toBe(true);
  });

  test("contains the placeholder instruction", () => {
    expect(CANONICAL_USER_MD_TEMPLATE).toContain("Replace this with context");
  });

  test("is non-empty markdown", () => {
    expect(CANONICAL_USER_MD_TEMPLATE.length).toBeGreaterThan(20);
  });
});
