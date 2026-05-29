import { describe, expect, test } from "bun:test";
import { install } from "../../src/cli/commands/install";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
import type { OrchestratorResult } from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
};

const emptyResult: OrchestratorResult = {
  installed: [],
  skipped: [],
  warnings: [],
  errors: [],
  grantedKnowledgeDirs: [],
  knowledge: [],
};

function bundleWithRequires(name: string, skills: Array<{ catalog?: string; name: string }>) {
  const b = fakeBundle(name);
  return {
    ...b,
    config: { ...b.config, requires: { skills } },
  } as AgentBundle;
}

describe("install CLI: requires.skills handling", () => {
  test("calls installSkillByRef when missing required skills", async () => {
    const installCalls: string[] = [];
    const code = await install({
      name: "team-helper",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [bundleWithRequires("team-helper", [{ catalog: "team", name: "jira-helper" }])],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "prompt",
      isTTY: () => true,
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(installCalls).toEqual(["team/jira-helper"]);
  });

  test("--no-skills: skips, warns, continues install", async () => {
    const installCalls: string[] = [];
    const printed: string[] = [];
    const code = await install({
      name: "team-helper",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [bundleWithRequires("team-helper", [{ name: "jira-helper" }])],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "no-skills",
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    expect(installCalls).toEqual([]);
    expect(printed.some((m) => /jira-helper/.test(m) && /may not function/.test(m))).toBe(true);
  });

  test("all required skills already installed → no install calls, no warnings", async () => {
    const installCalls: string[] = [];
    const code = await install({
      name: "team-helper",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [bundleWithRequires("team-helper", [{ name: "jira-helper" }])],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => ["jira-helper"],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "prompt",
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(installCalls).toEqual([]);
  });

  test("agent without requires.skills → no skill calls", async () => {
    const installCalls: string[] = [];
    const code = await install({
      name: "plain",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("plain")], failures: [] }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => {
        throw new Error("must not be called");
      },
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "prompt",
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(installCalls).toEqual([]);
  });

  test("successfully installed skill prints a one-line summary", async () => {
    const printed: string[] = [];
    const code = await install({
      name: "team-helper",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [bundleWithRequires("team-helper", [{ catalog: "team", name: "jira-helper" }])],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async () => {},
      prompt: async () => "y",
      skillMode: "with-skills",
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    expect(printed.some((m) => /team\/jira-helper/.test(m) && /installed/.test(m))).toBe(true);
  });

  test("build failure short-circuits BEFORE required skills are installed", async () => {
    const installCalls: string[] = [];
    let buildCalled = false;
    const code = await install({
      name: "team-helper",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [bundleWithRequires("team-helper", [{ catalog: "team", name: "jira-helper" }])],
        failures: [],
      }),
      buildAndInstall: async () => {
        buildCalled = true;
        return {
          installed: [],
          skipped: [],
          warnings: [],
          errors: [{ agent: "team-helper", messages: ["malformed config"] }],
          grantedKnowledgeDirs: [],
          knowledge: [],
        };
      },
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "with-skills",
      isTTY: () => true,
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(1);
    expect(buildCalled).toBe(true);
    // Skill MUST NOT be installed when the agent build itself failed —
    // otherwise we mutate the user's skill set for an agent that didn't ship.
    expect(installCalls).toEqual([]);
  });
});
