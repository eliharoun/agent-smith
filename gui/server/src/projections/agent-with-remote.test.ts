// gui/server/src/projections/agent-with-remote.test.ts
//
// C4.1.3 (v1-task): pure projection that merges a registry `remote{}`
// block into an AgentSummary. Decoupled from registry parsing so each
// piece is testable in isolation; the wiring step (C4.1.4) supplies the
// rootPath→remote lookup.

import { describe, expect, it } from "bun:test";
import type { AgentSummary } from "gui-shared";
import { agentWithRemote } from "./agent-with-remote";

const baseSummary: AgentSummary = {
  name: "alpha",
  description: "test",
  catalog: "team",
  path: "/abs/remote/github.com/o/r/alpha",
  targets: ["claude-code"],
};

describe("agentWithRemote (C4.1.3)", () => {
  it("returns input unchanged when no remote is found for the catalog rootPath", () => {
    const result = agentWithRemote(baseSummary, new Map());
    expect(result.remote).toBeUndefined();
  });

  it("merges remote{} into the summary when the catalog rootPath has one", () => {
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
    const result = agentWithRemote(baseSummary, remotes);
    expect(result.remote?.url).toBe("https://github.com/o/r.git");
    expect(result.remote?.lastPulledSha).toBe("a".repeat(40));
  });

  it("returns input unchanged when the catalog has no remote (local catalog)", () => {
    const remotes = new Map([["/some/other/path", { url: "https://x/y/z.git", ref: "main" }]]);
    const result = agentWithRemote(baseSummary, remotes);
    expect(result.remote).toBeUndefined();
  });

  it("does not mutate the input summary", () => {
    const input = { ...baseSummary };
    const remotes = new Map([
      ["/abs/remote/github.com/o/r", { url: "https://x/y/z.git", ref: "main" }],
    ]);
    agentWithRemote(input, remotes);
    expect(input.remote).toBeUndefined();
  });

  it("uses the longest matching rootPath prefix when multiple catalogs match", () => {
    // Defensive: a catalog at /a/b should not be shadowed by /a when both
    // are registered. agent.path /a/b/c/alpha must pick /a/b.
    const remotes = new Map([
      ["/a", { url: "https://short/x.git", ref: "main" }],
      ["/a/b", { url: "https://long/x.git", ref: "main" }],
    ]);
    const result = agentWithRemote({ ...baseSummary, path: "/a/b/c/alpha" }, remotes);
    expect(result.remote?.url).toBe("https://long/x.git");
  });
});
