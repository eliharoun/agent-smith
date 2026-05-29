import { describe, expect, test } from "bun:test";
import { deriveDefaultCatalogLabel } from "../../src/io/catalog-label";

describe("deriveDefaultCatalogLabel", () => {
  test("strips leading dot from parent segment", () => {
    expect(deriveDefaultCatalogLabel("/Users/x/.agent-smith/skills")).toBe(
      "agent-smith-skills",
    );
  });

  test("plain parent + basename", () => {
    expect(deriveDefaultCatalogLabel("/repo/skills")).toBe("repo-skills");
  });

  test("nested parent uses immediate parent only", () => {
    expect(deriveDefaultCatalogLabel("/Users/x/projects/myrepo/agents")).toBe(
      "myrepo-agents",
    );
  });

  test("filesystem root parent falls back to basename", () => {
    expect(deriveDefaultCatalogLabel("/skills")).toBe("skills");
  });

  test("preserves spaces and special chars verbatim", () => {
    expect(deriveDefaultCatalogLabel("/Users/x/My Skills/foo")).toBe(
      "My Skills-foo",
    );
  });

  test("trailing slash is tolerated", () => {
    expect(deriveDefaultCatalogLabel("/repo/skills/")).toBe("repo-skills");
  });
});
