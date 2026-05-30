// Task 2.6: skill installer extension for kiro.
// Asserts the public API surface (defaultPlatformSkillDirs.kiro,
// defaultInstallPaths.kiro, PlatformDirs.kiro). End-to-end install
// flow for skills is covered by tests/io/skill-installer.test.ts;
// this file pins the kiro-specific shape additions.

import { describe, expect, test } from "bun:test";
import { defaultInstallPaths } from "../../src/cli/install-paths";
import { defaultPlatformSkillDirs } from "../../src/io/skill-installer";

describe("Task 2.6: kiro install paths", () => {
  test("defaultInstallPaths includes kiro at ~/.kiro/agents", () => {
    const paths = defaultInstallPaths();
    expect(paths.kiro).toBeDefined();
    expect(paths.kiro).toMatch(/\.kiro\/agents$/);
  });

  test("defaultPlatformSkillDirs includes kiro at ~/.kiro/skills", () => {
    const dirs = defaultPlatformSkillDirs();
    expect(dirs.kiro).toBeDefined();
    expect(dirs.kiro).toMatch(/\.kiro\/skills$/);
  });

  test("defaultPlatformSkillDirs honors custom home dir override", () => {
    const dirs = defaultPlatformSkillDirs("/tmp/test-home");
    expect(dirs.kiro).toBe("/tmp/test-home/.kiro/skills");
  });
});
