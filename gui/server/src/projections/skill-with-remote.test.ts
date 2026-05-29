// gui/server/src/projections/skill-with-remote.test.ts
//
// C4.1.3 (v1-task): pure projection that merges a registry `remote{}`
// block into a SkillSummary. Mirrors agentWithRemote: lookup by longest
// matching rootPath prefix against the skill's path, since each catalog
// can contain many skills.

import { describe, expect, it } from "bun:test";
import type { SkillSummary } from "gui-shared";
import { skillWithRemote } from "./skill-with-remote";

const baseSummary: SkillSummary = {
  name: "beta",
  description: "test",
  catalogLabel: "team",
  path: "/abs/remote/github.com/o/r/skills/beta",
};

describe("skillWithRemote (C4.1.3)", () => {
  it("returns input unchanged when no remote matches", () => {
    const result = skillWithRemote(baseSummary, new Map());
    expect(result.remote).toBeUndefined();
  });

  it("merges remote{} when the catalog rootPath is a prefix of skill.path", () => {
    const remotes = new Map([
      [
        "/abs/remote/github.com/o/r",
        {
          url: "https://github.com/o/r.git",
          ref: "main",
          lastPulledSha: "a".repeat(40),
          lastPulledAt: "2026-05-25T10:00:00.000Z",
        },
      ],
    ]);
    const result = skillWithRemote(baseSummary, remotes);
    expect(result.remote?.url).toBe("https://github.com/o/r.git");
  });

  it("does not mutate the input summary", () => {
    const input = { ...baseSummary };
    const remotes = new Map([
      ["/abs/remote/github.com/o/r", { url: "https://x/y/z.git", ref: "main" }],
    ]);
    skillWithRemote(input, remotes);
    expect(input.remote).toBeUndefined();
  });

  it("uses the longest matching rootPath prefix when multiple catalogs match", () => {
    const remotes = new Map([
      ["/a", { url: "https://short/x.git", ref: "main" }],
      ["/a/b", { url: "https://long/x.git", ref: "main" }],
    ]);
    const result = skillWithRemote({ ...baseSummary, path: "/a/b/skills/beta" }, remotes);
    expect(result.remote?.url).toBe("https://long/x.git");
  });
});
