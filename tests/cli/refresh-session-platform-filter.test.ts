import { describe, expect, test } from "bun:test";
import { filterAgentsByPlatform } from "../../src/cli/commands/knowledge/refresh-session-agents";
import type { RunnerAgent } from "../../src/cli/commands/knowledge/refresh-session-runner";

/** Verifies the platform-scoping contract used by `listInstalledAgentsForRefresh`
 *  to honour `--platform <id>`. Kept isolated from the I/O-coupled enumeration
 *  so the filter behaviour can be locked in without standing up a real registry. */
describe("filterAgentsByPlatform", () => {
  const claudeOnly: RunnerAgent = {
    name: "claude-only",
    targets: ["claude-code"],
    sources: [],
  };
  const codexOnly: RunnerAgent = {
    name: "codex-only",
    targets: ["codex"],
    sources: [],
  };
  const opencodeOnly: RunnerAgent = {
    name: "opencode-only",
    targets: ["opencode"],
    sources: [],
  };
  const multi: RunnerAgent = {
    name: "multi",
    targets: ["claude-code", "codex"],
    sources: [],
  };
  const all = [claudeOnly, codexOnly, opencodeOnly, multi];

  test("undefined filter returns input unchanged", () => {
    expect(filterAgentsByPlatform(all)).toEqual(all);
    expect(filterAgentsByPlatform(all, undefined)).toEqual(all);
  });

  test("codex filter selects only codex-targeted agents", () => {
    const got = filterAgentsByPlatform(all, "codex");
    expect(got.map((a) => a.name)).toEqual(["codex-only", "multi"]);
  });

  test("claude-code filter selects only claude-code-targeted agents", () => {
    const got = filterAgentsByPlatform(all, "claude-code");
    expect(got.map((a) => a.name)).toEqual(["claude-only", "multi"]);
  });

  test("opencode filter selects only opencode-targeted agents", () => {
    const got = filterAgentsByPlatform(all, "opencode");
    expect(got.map((a) => a.name)).toEqual(["opencode-only"]);
  });

  test("empty input produces empty output regardless of filter", () => {
    expect(filterAgentsByPlatform([], "codex")).toEqual([]);
    expect(filterAgentsByPlatform([])).toEqual([]);
  });

  test("returned array is a new array (does not mutate input)", () => {
    const got = filterAgentsByPlatform(all, "codex");
    expect(got).not.toBe(all);
    expect(all).toHaveLength(4); // unchanged
  });
});
