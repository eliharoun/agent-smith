import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  checkProtectedBundles,
  type CheckProtectedBundlesInput,
} from "../../../src/core/freshness/protected-bundles-section";
import { _setCloneModeForTesting } from "../../../src/core/protected-bundles";

const input = (over: Partial<CheckProtectedBundlesInput> = {}): CheckProtectedBundlesInput => ({
  agentNames: new Set(),
  installedSkillPaths: new Map(),
  ...over,
});

describe("checkProtectedBundles", () => {
  beforeEach(() => _setCloneModeForTesting(false));
  afterEach(() => _setCloneModeForTesting(null));

  test("reports agent-smith when present in the registry", () => {
    const r = checkProtectedBundles(input({ agentNames: new Set(["agent-smith", "my-agent"]) }));
    const names = r.findings.map((f) => f.name);
    expect(names).toContain("agent-smith");
    expect(names).not.toContain("my-agent");
  });

  test("reports bundled skills with their source path", () => {
    const r = checkProtectedBundles(
      input({
        installedSkillPaths: new Map([
          ["the-architect", "/x/the-architect"],
          ["my-skill", "/x/my-skill"],
        ]),
      }),
    );
    const arch = r.findings.find((f) => f.name === "the-architect");
    expect(arch?.kind).toBe("skill");
    expect(arch?.sourcePath).toBe("/x/the-architect");
    expect(r.findings.find((f) => f.name === "my-skill")).toBeUndefined();
  });

  test("no findings + cloneMode false when nothing protected is present", () => {
    const r = checkProtectedBundles(input());
    expect(r.findings).toHaveLength(0);
    expect(r.cloneMode).toBe(false);
  });

  test("adds a clone-mode finding when isLocalSmithClone() is true", () => {
    _setCloneModeForTesting(true);
    const r = checkProtectedBundles(input({ agentNames: new Set(["agent-smith"]) }));
    expect(r.cloneMode).toBe(true);
    expect(r.findings.some((f) => f.kind === "clone-mode")).toBe(true);
    // The agent finding is still present alongside the clone-mode note.
    expect(r.findings.some((f) => f.kind === "agent" && f.name === "agent-smith")).toBe(true);
  });
});
