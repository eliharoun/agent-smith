import { describe, expect, test } from "bun:test";
import { catalogMode, type CatalogMode } from "../../src/core/source-mode";

describe("catalogMode", () => {
  test("returns 'managed' when remote is present", () => {
    expect(catalogMode({ remote: { url: "https://github.com/o/r" } })).toBe("managed");
  });

  test("returns 'linked' when remote is undefined", () => {
    expect(catalogMode({ remote: undefined })).toBe("linked");
  });

  test("returns 'linked' when remote is missing entirely", () => {
    expect(catalogMode({})).toBe("linked");
  });

  test("works on full Source-shaped input", () => {
    const src = {
      label: "test",
      kind: "user-global" as const,
      rootPath: "/tmp/x",
      remote: { url: "https://github.com/o/r" },
    };
    expect(catalogMode(src)).toBe("managed");
  });

  test("works on full SkillCatalog-shaped input", () => {
    const cat = {
      label: "test",
      kind: "user-global" as const,
      rootPath: "/tmp/x",
      remote: undefined,
    };
    expect(catalogMode(cat)).toBe("linked");
  });

  test("CatalogMode type is exactly 'managed' | 'linked' (compile-time)", () => {
    const m: CatalogMode = "managed";
    const l: CatalogMode = "linked";
    expect([m, l]).toEqual(["managed", "linked"]);
    const bad: string = "other";
    expect(bad).toBe("other");
  });
});
