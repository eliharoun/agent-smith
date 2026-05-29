import { describe, expect, test } from "bun:test";
import { assembleBody } from "../../src/core/assembler";

const baseInput = {
  identity: "You are a reviewer.",
  expertise: "You spot N+1.",
  soul: "You are terse.",
  user: "You note things.",
};

describe("assembler: skills section", () => {
  test("omits Default Skills section when skills is empty", () => {
    expect(assembleBody(baseInput, { skills: [], descriptions: new Map() })).not.toContain(
      "Default Skills",
    );
  });

  test("omits Default Skills section when skills option is absent", () => {
    expect(assembleBody(baseInput)).not.toContain("Default Skills");
  });

  test("appends Default Skills section after USER content", () => {
    const out = assembleBody(baseInput, {
      skills: ["systematic-debugging"],
      descriptions: new Map([["systematic-debugging", "Use when encountering any bug"]]),
    });
    expect(out).toContain("## Default Skills");
    expect(out).toContain("`systematic-debugging` — Use when encountering any bug");
    const userIndex = out.indexOf(baseInput.user);
    const skillsIndex = out.indexOf("## Default Skills");
    expect(skillsIndex).toBeGreaterThan(userIndex);
  });

  test("renders bare bullet when description is missing", () => {
    const out = assembleBody(baseInput, {
      skills: ["mystery-skill"],
      descriptions: new Map(),
    });
    expect(out).toContain("- `mystery-skill`");
    expect(out).not.toContain("`mystery-skill` —");
  });

  test("renders mixed list of described and bare skills", () => {
    const out = assembleBody(baseInput, {
      skills: ["a", "b"],
      descriptions: new Map([["a", "described"]]),
    });
    expect(out).toContain("- `a` — described");
    expect(out).toContain("- `b`");
  });

  test("separates Default Skills from USER content with a horizontal rule", () => {
    const out = assembleBody(baseInput, {
      skills: ["x"],
      descriptions: new Map([["x", "desc"]]),
    });
    // The skills section is its own block separated by ---, like the others
    expect(out).toContain("---\n\n## Default Skills");
  });

  test("includes the second-person preamble before the bullet list", () => {
    const out = assembleBody(baseInput, {
      skills: ["x"],
      descriptions: new Map([["x", "desc"]]),
    });
    expect(out).toContain(
      "You have access to these skills and should invoke them when their description matches your task:",
    );
  });

  test("preserves existing four-block ordering", () => {
    const out = assembleBody(baseInput, {
      skills: ["x"],
      descriptions: new Map([["x", "desc"]]),
    });
    const idIdx = out.indexOf(baseInput.identity);
    const exIdx = out.indexOf(baseInput.expertise);
    const soulIdx = out.indexOf(baseInput.soul);
    const userIdx = out.indexOf(baseInput.user);
    const skillIdx = out.indexOf("## Default Skills");
    expect(idIdx).toBeLessThan(exIdx);
    expect(exIdx).toBeLessThan(soulIdx);
    expect(soulIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(skillIdx);
  });
});
