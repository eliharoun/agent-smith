// tests/core/freshness/duplicate-catalogs.test.ts
//
// [v1-task RC2-10] Unit coverage for checkDuplicateCatalogs.
// Pure-function tests — no fs, no git, no clock.

import { describe, expect, test } from "bun:test";
import { checkDuplicateCatalogs } from "../../../src/core/freshness/duplicate-catalogs";
import type { Registry } from "../../../src/io/registry";
import type { SkillRegistry } from "../../../src/io/skill-registry";

function reg(sources: Registry["sources"]): Registry {
  return { schemaVersion: 2, sources };
}

function skillReg(catalogs: SkillRegistry["catalogs"]): SkillRegistry {
  return { schemaVersion: 2, catalogs };
}

describe("checkDuplicateCatalogs [v1-task RC2-10]", () => {
  test("empty registries → no clusters", () => {
    const r = checkDuplicateCatalogs({
      registry: reg([]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toEqual([]);
  });

  test("single registry, no duplicates → no clusters", () => {
    const r = checkDuplicateCatalogs({
      registry: reg([
        {
          kind: "registered",
          rootPath: "/x/a",
          label: "a",
          gitRemote: "https://github.com/o/a.git",
        },
      ]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toEqual([]);
  });

  test("entries without gitRemote are ignored", () => {
    const r = checkDuplicateCatalogs({
      registry: reg([
        { kind: "user-global", rootPath: "/x/a", label: "a" },
        { kind: "user-global", rootPath: "/x/b", label: "b" },
      ]),
      skillRegistry: skillReg([{ kind: "user-global", rootPath: "/y/a", label: "ya" }]),
    });
    expect(r.clusters).toEqual([]);
  });

  test("two agent catalogs with identical URLs → one cluster of size 2", () => {
    const url = "https://github.com/owner/repo.git";
    const r = checkDuplicateCatalogs({
      registry: reg([
        { kind: "registered", rootPath: "/x/one", label: "one", gitRemote: url },
        { kind: "registered", rootPath: "/x/two", label: "two", gitRemote: url },
      ]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.members).toHaveLength(2);
    expect(r.clusters[0]?.members.map((m) => m.label).sort()).toEqual(["one", "two"]);
  });

  test("normalization clusters URL spelling variants together", () => {
    // Three spellings of the same upstream repo: https vs ssh,
    // .git suffix, owner case. normalizeGitUrl lowercases the first 3
    // path segments and strips .git, so all three must hash to one key.
    const r = checkDuplicateCatalogs({
      registry: reg([
        {
          kind: "registered",
          rootPath: "/a",
          label: "https",
          gitRemote: "https://github.com/Owner/Repo.git",
        },
        {
          kind: "registered",
          rootPath: "/b",
          label: "ssh",
          gitRemote: "git@github.com:owner/repo",
        },
        {
          kind: "registered",
          rootPath: "/c",
          label: "noSuffix",
          gitRemote: "https://github.com/OWNER/REPO",
        },
      ]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.members.map((m) => m.label).sort()).toEqual(["https", "noSuffix", "ssh"]);
  });

  test("cross-registry cluster: agent + skill catalog of same repo", () => {
    const url = "https://github.com/team/pack.git";
    const r = checkDuplicateCatalogs({
      registry: reg([{ kind: "registered", rootPath: "/a", label: "agent-pack", gitRemote: url }]),
      skillRegistry: skillReg([
        { kind: "team-shared", rootPath: "/s", label: "skill-pack", gitRemote: url },
      ]),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.members.map((m) => m.registryKind).sort()).toEqual(["agent", "skill"]);
  });

  test("multiple clusters returned in normalizedUrl order", () => {
    const url1 = "https://github.com/a/one.git";
    const url2 = "https://github.com/z/two.git";
    const r = checkDuplicateCatalogs({
      registry: reg([
        { kind: "registered", rootPath: "/za", label: "z1", gitRemote: url2 },
        { kind: "registered", rootPath: "/zb", label: "z2", gitRemote: url2 },
        { kind: "registered", rootPath: "/aa", label: "a1", gitRemote: url1 },
        { kind: "registered", rootPath: "/ab", label: "a2", gitRemote: url1 },
      ]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toHaveLength(2);
    // Sorted: github.com/a/one < github.com/z/two.
    expect(r.clusters[0]?.normalizedUrl).toContain("a/one");
    expect(r.clusters[1]?.normalizedUrl).toContain("z/two");
  });

  test("malformed URLs are excluded (no throw)", () => {
    // normalizeGitUrl rejects URLs with no host. Bad entries must not
    // crash doctor; they're just excluded from clustering.
    const r = checkDuplicateCatalogs({
      registry: reg([
        { kind: "registered", rootPath: "/a", label: "bad", gitRemote: "not-a-url" },
        { kind: "registered", rootPath: "/b", label: "also-bad", gitRemote: "://x" },
      ]),
      skillRegistry: skillReg([]),
    });
    expect(r.clusters).toEqual([]);
  });
});
