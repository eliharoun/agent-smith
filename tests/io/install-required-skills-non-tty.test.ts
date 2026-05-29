import { describe, expect, test } from "bun:test";
import {
  type InstallRequiredSkillsOpts,
  installRequiredSkills,
} from "../../src/io/install-required-skills";

describe("installRequiredSkills: non-TTY safety", () => {
  test("prompt mode + non-TTY → skip + warn (does not hang on stdin)", async () => {
    const installCalls: string[] = [];
    const opts: InstallRequiredSkillsOpts = {
      agentName: "team-helper",
      required: [{ name: "jira-helper" }, { catalog: "team", name: "confluence-helper" }],
      mode: "prompt",
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      // If the prompt is reached in non-TTY, this would normally block forever.
      // We make it throw so a regression manifests as a thrown error rather
      // than a hung test.
      prompt: async () => {
        throw new Error("prompt should not be called in non-TTY mode");
      },
      isTTY: () => false,
    };
    const result = await installRequiredSkills(opts);
    expect(installCalls).toEqual([]);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(["jira-helper", "team/confluence-helper"]);
    // Warning should name each missing skill and explain how to override.
    const warningsBlob = result.warnings.join("\n");
    expect(warningsBlob).toMatch(/non-?TTY|non-interactive/i);
    expect(warningsBlob).toMatch(/jira-helper/);
    expect(warningsBlob).toMatch(/team\/confluence-helper/);
    expect(warningsBlob).toMatch(/--yes|--with-skills/);
    expect(warningsBlob).toMatch(/--no-skills/);
  });

  test("with-skills mode + non-TTY → still installs (explicit consent via flag)", async () => {
    const installCalls: string[] = [];
    const result = await installRequiredSkills({
      agentName: "team-helper",
      required: [{ name: "jira-helper" }],
      mode: "with-skills",
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => {
        throw new Error("prompt should not be called in with-skills mode");
      },
      isTTY: () => false,
    });
    expect(installCalls).toEqual(["jira-helper"]);
    expect(result.installed).toEqual(["jira-helper"]);
  });

  test("prompt mode + TTY → prompts as before (regression check)", async () => {
    const result = await installRequiredSkills({
      agentName: "team-helper",
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async () => {},
      prompt: async () => "y",
      isTTY: () => true,
    });
    expect(result.installed).toEqual(["jira-helper"]);
  });
});
