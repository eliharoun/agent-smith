import { describe, expect, test } from "bun:test";
import { CanonicalConfigSchema, parseConfig } from "../../src/core/config-schema";

const baseValid = {
  schemaVersion: 1,
  name: "team-helper",
  description: "Use proactively to query Atlassian Cloud via atlassian-skills.",
  targets: ["opencode"],
  modelTier: "balanced",
} as const;

describe("CanonicalConfigSchema: requires.skills", () => {
  test("requires field is optional (omitted entirely)", () => {
    const result = CanonicalConfigSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  test("accepts requires.skills as an array of {catalog, name}", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: {
        skills: [
          { catalog: "team", name: "jira-helper" },
          { catalog: "team", name: "confluence-helper" },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts requires.skills entries with only `name` (catalog optional)", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: { skills: [{ name: "jira-helper" }] },
    });
    expect(result.success).toBe(true);
  });

  test("accepts an empty skills array (no-op but legal)", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: { skills: [] },
    });
    expect(result.success).toBe(true);
  });

  test("rejects a skill name that violates kebab-case", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: { skills: [{ name: "Bad_Name" }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("skills"))).toBe(true);
    }
  });

  test("rejects a skill entry missing `name`", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: { skills: [{ catalog: "team" }] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects requires.skills as a non-array (e.g. string)", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...baseValid,
      requires: { skills: "jira-helper" },
    });
    expect(result.success).toBe(false);
  });

  test("parseConfig strips undefined keys when requires omitted", () => {
    const result = parseConfig(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, "requires")).toBe(false);
    }
  });

  test("parseConfig preserves requires when present", () => {
    const result = parseConfig({
      ...baseValid,
      requires: { skills: [{ name: "jira-helper" }] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requires).toEqual({ skills: [{ name: "jira-helper" }] });
    }
  });
});
