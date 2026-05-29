// gui/server/src/skills-shape.test.ts
//
// C4.1.2 (v1-task): pin SkillSummary wire shape after adding the optional
// `remote{}` block. See agents-shape.test.ts for the parallel agent test.

import { describe, expect, it } from "bun:test";
import { SkillSummary } from "gui-shared";

const minimalLocal = {
  name: "beta",
  description: "test skill",
  catalogLabel: "user-global",
  path: "/abs/path/beta",
};

describe("SkillSummary wire shape (C4.1.2)", () => {
  it("accepts a summary without a remote block (local skill)", () => {
    const s = SkillSummary.parse(minimalLocal);
    expect(s.remote).toBeUndefined();
  });

  it("accepts a summary with a remote block (team-shared skill)", () => {
    const s = SkillSummary.parse({
      ...minimalLocal,
      remote: { url: "https://x/y/z.git", ref: "main" },
    });
    expect(s.remote?.url).toBe("https://x/y/z.git");
  });

  it("accepts a summary with a fully-populated remote block", () => {
    const s = SkillSummary.parse({
      ...minimalLocal,
      remote: {
        url: "https://x/y/z.git",
        ref: "main",
        lastPulledSha: "a".repeat(40),
        lastPulledAt: "2026-05-25T10:00:00.000Z",
        lastRemoteSha: "b".repeat(40),
        lastCheckedAt: "2026-05-25T10:05:00.000Z",
      },
    });
    expect(s.remote?.lastPulledSha).toBe("a".repeat(40));
  });

  it("rejects a malformed remote block (empty url)", () => {
    expect(() =>
      SkillSummary.parse({
        ...minimalLocal,
        remote: { url: "", ref: "main" },
      }),
    ).toThrow();
  });
});
