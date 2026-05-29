import { describe, expect, test } from "bun:test";
import {
  type InstallRequiredSkillsOpts,
  installRequiredSkills,
} from "../../src/io/install-required-skills";
import type { RequiredSkillEntry } from "../../src/io/required-skills";

interface Spy {
  installCalls: string[];
  promptCalls: string[];
}

interface OptsBundle {
  opts: InstallRequiredSkillsOpts;
  spy: Spy;
}

function makeOpts(overrides: {
  required: RequiredSkillEntry[];
  installed?: string[];
  mode?: "prompt" | "with-skills" | "no-skills";
  promptAnswers?: string[];
  installShouldFail?: (ref: string) => boolean;
}): OptsBundle {
  const installed = overrides.installed ?? [];
  const installCalls: string[] = [];
  const promptAnswers = [...(overrides.promptAnswers ?? [])];
  const promptCalls: string[] = [];
  const opts: InstallRequiredSkillsOpts = {
    agentName: "team-helper",
    required: overrides.required,
    mode: overrides.mode ?? "prompt",
    loadInstalledSkillNames: async () => installed,
    installSkillByRef: async (ref: string) => {
      installCalls.push(ref);
      if (overrides.installShouldFail?.(ref)) {
        throw new Error(`boom: ${ref}`);
      }
    },
    prompt: async (msg: string) => {
      promptCalls.push(msg);
      return promptAnswers.shift() ?? "";
    },
    // Default to TTY so existing prompt-mode tests exercise the prompt path.
    // The non-TTY skip-and-warn behavior is covered in
    // install-required-skills-non-tty.test.ts.
    isTTY: () => true,
  };
  return { opts, spy: { installCalls, promptCalls } };
}

describe("installRequiredSkills", () => {
  test("no required skills → no-op, no warnings, success", async () => {
    const { opts } = makeOpts({ required: [] });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("all required already installed → early-out, success", async () => {
    const { opts, spy } = makeOpts({
      required: [{ name: "jira-helper" }, { catalog: "team", name: "confluence-helper" }],
      installed: ["jira-helper", "confluence-helper"],
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(spy.promptCalls.length).toBe(0);
  });

  test("prompt mode: user answers 'y' (default) → installs each missing skill", async () => {
    const { opts, spy } = makeOpts({
      required: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
      mode: "prompt",
      promptAnswers: ["y", "y"],
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual(["team/jira-helper", "confluence-helper"]);
    expect(result.skipped).toEqual([]);
    expect(spy.installCalls).toEqual(["team/jira-helper", "confluence-helper"]);
  });

  test("prompt mode: empty answer counts as yes (default)", async () => {
    const { opts } = makeOpts({
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      promptAnswers: [""],
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual(["jira-helper"]);
  });

  test("prompt mode: user answers 'n' → skip and warn", async () => {
    const { opts } = makeOpts({
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      promptAnswers: ["n"],
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(["jira-helper"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/jira-helper/);
    expect(result.warnings[0]).toMatch(/may not function/);
  });

  test("prompt mode: 'no' (full word) is accepted as no", async () => {
    const { opts, spy } = makeOpts({
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      promptAnswers: ["no"],
    });
    const result = await installRequiredSkills(opts);
    expect(spy.installCalls).toEqual([]);
    expect(result.skipped).toEqual(["jira-helper"]);
  });

  test("prompt mode: ambiguous answer re-prompts, then accepts the second answer", async () => {
    // First answer 'maybe' should NOT silently count as no — re-prompt.
    // Tests that the user gets a chance to correct themselves rather than
    // an unintended skip.
    const { opts, spy } = makeOpts({
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      promptAnswers: ["maybe", "y"],
    });
    const result = await installRequiredSkills(opts);
    expect(spy.promptCalls.length).toBe(2);
    expect(result.installed).toEqual(["jira-helper"]);
  });

  test("prompt mode: ambiguous answer 3x → treats as no with explanatory warning", async () => {
    const { opts, spy } = makeOpts({
      required: [{ name: "jira-helper" }],
      mode: "prompt",
      promptAnswers: ["maybe", "huh", "?"],
    });
    const result = await installRequiredSkills(opts);
    expect(spy.installCalls).toEqual([]);
    expect(result.skipped).toEqual(["jira-helper"]);
    expect(spy.promptCalls.length).toBe(3);
    // Warning should explain WHY we skipped (not the generic "may not function").
    expect(result.warnings.join("\n")).toMatch(/unclear|did not understand|skipping/i);
  });

  test("--with-skills mode: auto-installs without prompting", async () => {
    const { opts, spy } = makeOpts({
      required: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
      mode: "with-skills",
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual(["team/jira-helper", "confluence-helper"]);
    expect(spy.promptCalls.length).toBe(0);
  });

  test("--no-skills mode: skips all and emits one warning per skipped skill", async () => {
    const { opts, spy } = makeOpts({
      required: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
      mode: "no-skills",
    });
    const result = await installRequiredSkills(opts);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(["team/jira-helper", "confluence-helper"]);
    expect(result.warnings).toHaveLength(2);
    expect(spy.promptCalls.length).toBe(0);
    expect(spy.installCalls.length).toBe(0);
  });

  test("install failure surfaces as a warning, does not abort agent install", async () => {
    const { opts, spy } = makeOpts({
      required: [{ name: "jira-helper" }, { name: "confluence-helper" }],
      mode: "with-skills",
      installShouldFail: (ref) => ref === "jira-helper",
    });
    const result = await installRequiredSkills(opts);
    expect(spy.installCalls).toEqual(["jira-helper", "confluence-helper"]);
    expect(result.installed).toEqual(["confluence-helper"]);
    expect(result.skipped).toEqual(["jira-helper"]);
    expect(result.warnings.some((w) => w.includes("boom: jira-helper"))).toBe(true);
  });
});
