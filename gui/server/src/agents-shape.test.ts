// gui/server/src/agents-shape.test.ts
//
// C4.1.2 (v1-task): pin AgentSummary wire shape after adding the optional
// `remote{}` block. Lives in gui/server (not gui/shared) because it
// exercises the schema as a downstream consumer, the same way list-route
// builders do. Pure parse-level test; no Hono harness needed.

import { describe, expect, it } from "bun:test";
import { AgentSummary } from "gui-shared";

const minimalLocal = {
  name: "alpha",
  description: "test agent",
  catalog: "user",
  path: "/abs/path/alpha",
  targets: ["claude-code"],
};

describe("AgentSummary wire shape (C4.1.2)", () => {
  it("accepts a summary without a remote block (local agent)", () => {
    const s = AgentSummary.parse(minimalLocal);
    expect(s.remote).toBeUndefined();
  });

  it("accepts a summary with a remote block (registry-remote agent)", () => {
    const s = AgentSummary.parse({
      ...minimalLocal,
      remote: { url: "https://x/y/z.git", ref: "main" },
    });
    expect(s.remote?.url).toBe("https://x/y/z.git");
    expect(s.remote?.ref).toBe("main");
  });

  it("accepts a summary with a fully-populated remote block", () => {
    const s = AgentSummary.parse({
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
    expect(s.remote?.lastRemoteSha).toBe("b".repeat(40));
  });

  it("rejects a malformed remote block (empty url)", () => {
    expect(() =>
      AgentSummary.parse({
        ...minimalLocal,
        remote: { url: "", ref: "main" },
      }),
    ).toThrow();
  });
});
