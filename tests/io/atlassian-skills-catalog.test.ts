import { describe, expect, test } from "bun:test";
import { bootstrapAtlassianSkillsCatalog, defaultSkillRegistry } from "../../src/io/skill-registry";

describe("bootstrapAtlassianSkillsCatalog", () => {
  test("returns a SkillCatalog with the canonical langpingxue URL", () => {
    const cat = bootstrapAtlassianSkillsCatalog();
    expect(cat.label).toBe("atlassian-skills");
    expect(cat.kind).toBe("team-shared");
    expect(cat.gitRemote).toBe("https://github.com/langpingxue/atlassian-skills.git");
    expect(cat.remote?.url).toBe("https://github.com/langpingxue/atlassian-skills.git");
    expect(cat.remote?.ref).toBe("HEAD");
    expect(cat.protected).toBe(true);
  });

  test("rootPath sits under <state-home>/remote/github.com/langpingxue/atlassian-skills", () => {
    const cat = bootstrapAtlassianSkillsCatalog();
    expect(cat.rootPath).toContain("remote/github.com/langpingxue/atlassian-skills");
  });
});

describe("defaultSkillRegistry", () => {
  test("contains atlassian-skills as the only seeded catalog", () => {
    const reg = defaultSkillRegistry();
    expect(reg.schemaVersion).toBe(2);
    expect(reg.catalogs.length).toBe(1);
    expect(reg.catalogs[0]?.label).toBe("atlassian-skills");
  });
});
