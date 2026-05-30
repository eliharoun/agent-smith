import { describe, expect, it } from "bun:test";
import { cacheDirFor, knowledgeDirFor } from "../../src/io/knowledge-paths";

describe("knowledgeDirFor", () => {
  it("derives the knowledge dir from agent-smith's home, not opencode's agents dir", () => {
    expect(
      knowledgeDirFor("my-agent", { agentSmithHome: "/h/.config/agent-smith" }),
    ).toBe("/h/.config/agent-smith/knowledge/my-agent");
  });

  it("returns a path that is NOT inside any platform agent-discovery dir", () => {
    const opencodeAgentsDir = "/h/.config/opencode/agents";
    const dir = knowledgeDirFor("foo", { agentSmithHome: "/h/.config/agent-smith" });
    expect(dir.startsWith(opencodeAgentsDir)).toBe(false);
  });
});

describe("cacheDirFor", () => {
  it("derives the cache dir under the new agent-smith knowledge home", () => {
    expect(cacheDirFor("my-agent", { agentSmithHome: "/h/.config/agent-smith" })).toBe(
      "/h/.config/agent-smith/knowledge/my-agent/.cache",
    );
  });
});
