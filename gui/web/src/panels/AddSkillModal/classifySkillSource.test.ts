import { describe, expect, it } from "vitest";
import { classifySkillSource } from "./classifySkillSource";

describe("classifySkillSource — delegation to classifySource", () => {
  it("SSH git URL → git-url", () => {
    expect(classifySkillSource("git@github.com:acme/skills.git")).toBe("git-url");
  });

  it("SSH guard: git@host:repo.tgz stays git-url (not archive)", () => {
    expect(classifySkillSource("git@host:acme/repo.tgz")).toBe("git-url");
  });

  it("https:// URL → git-url", () => {
    expect(classifySkillSource("https://github.com/acme/skills")).toBe("git-url");
  });

  it("https:// tgz URL → archive", () => {
    expect(classifySkillSource("https://example.com/skills.tgz")).toBe("archive");
  });

  it("absolute path → directory", () => {
    expect(classifySkillSource("/Users/me/skills")).toBe("directory");
  });

  it("home-relative path → directory", () => {
    expect(classifySkillSource("~/skills")).toBe("directory");
  });

  it("dot-relative path → directory", () => {
    expect(classifySkillSource("./skills")).toBe("directory");
  });
});

describe("classifySkillSource — catalog-ref detection", () => {
  it("'default/tdd' → catalog-ref", () => {
    expect(classifySkillSource("default/tdd")).toBe("catalog-ref");
  });

  it("'acme-org/my-skill.v2' → catalog-ref (dots and hyphens allowed)", () => {
    expect(classifySkillSource("acme-org/my-skill.v2")).toBe("catalog-ref");
  });

  it("whitespace is trimmed before classifying", () => {
    expect(classifySkillSource("  default/tdd  ")).toBe("catalog-ref");
  });

  // By-design ambiguity: a bare two-segment token like "foo/bar" is treated as
  // a catalog-ref (acceptable per spec — it's not a valid path or URL).
  it("'foo/bar' → catalog-ref (by-design: bare two-segment token is a catalog ref)", () => {
    expect(classifySkillSource("foo/bar")).toBe("catalog-ref");
  });

  // Case-insensitive regex: uppercase letters are allowed in catalog/name.
  it("'Foo/Bar' → catalog-ref (case-insensitive regex)", () => {
    expect(classifySkillSource("Foo/Bar")).toBe("catalog-ref");
  });
});

describe("classifySkillSource — unknown inputs (no bypass)", () => {
  it("bare word stays unknown", () => {
    expect(classifySkillSource("tdd")).toBe("unknown");
  });

  it("multi-segment path 'a/b/c' stays unknown", () => {
    expect(classifySkillSource("a/b/c")).toBe("unknown");
  });

  it("empty string stays unknown", () => {
    expect(classifySkillSource("")).toBe("unknown");
  });

  it("leading slash (absolute path) is directory, not catalog-ref", () => {
    expect(classifySkillSource("/default/tdd")).toBe("directory");
  });

  it("path with spaces stays unknown", () => {
    expect(classifySkillSource("my catalog/my skill")).toBe("unknown");
  });
});
