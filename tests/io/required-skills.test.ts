import { describe, expect, test } from "bun:test";
import {
  diffRequiredSkills,
  formatSkillRef,
  type RequiredSkillEntry,
} from "../../src/io/required-skills";

describe("formatSkillRef", () => {
  test("formats catalog/name when catalog is present", () => {
    expect(formatSkillRef({ catalog: "team", name: "jira-helper" })).toBe("team/jira-helper");
  });

  test("formats just name when catalog is absent", () => {
    expect(formatSkillRef({ name: "jira-helper" })).toBe("jira-helper");
  });
});

describe("diffRequiredSkills", () => {
  test("returns empty array when all required skills are installed", () => {
    const required: RequiredSkillEntry[] = [{ name: "a" }, { catalog: "x", name: "b" }];
    const installed = ["a", "b", "c"];
    expect(diffRequiredSkills(required, installed)).toEqual([]);
  });

  test("returns missing entries (preserving catalog field)", () => {
    const required: RequiredSkillEntry[] = [
      { name: "a" },
      { catalog: "team", name: "jira-helper" },
      { name: "c" },
    ];
    const installed = ["a"];
    expect(diffRequiredSkills(required, installed)).toEqual([
      { catalog: "team", name: "jira-helper" },
      { name: "c" },
    ]);
  });

  test("matches by name only — catalog is irrelevant for the installed check", () => {
    const required: RequiredSkillEntry[] = [{ catalog: "team", name: "jira-helper" }];
    const installed = ["jira-helper"];
    expect(diffRequiredSkills(required, installed)).toEqual([]);
  });

  test("empty required → empty diff", () => {
    expect(diffRequiredSkills([], ["a", "b"])).toEqual([]);
  });

  test("empty installed → all required are missing", () => {
    const required: RequiredSkillEntry[] = [{ name: "a" }, { name: "b" }];
    expect(diffRequiredSkills(required, [])).toEqual(required);
  });
});
