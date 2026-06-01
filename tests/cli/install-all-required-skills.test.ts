import { describe, expect, test } from "bun:test";
import { installAll } from "../../src/cli/commands/install-all";
import { SmithError } from "../../src/core/smith-error";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
import type { OrchestratorResult } from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
  "agents-md": "/fake/agents-md/agents",
};

const emptyResult: OrchestratorResult = {
  installed: [],
  skipped: [],
  warnings: [],
  errors: [],
  grantedKnowledgeDirs: [],
  knowledge: [],
};

function bundleWithRequires(
  name: string,
  skills: Array<{ catalog?: string; name: string }>,
): AgentBundle {
  const b = fakeBundle(name);
  return {
    ...b,
    config: { ...b.config, requires: { skills } },
  } as AgentBundle;
}

describe("cli/install-all: requires.skills propagation", () => {
  test("--with-skills: installs required skills for every agent", async () => {
    const installCalls: string[] = [];
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          bundleWithRequires("agent-a", [{ catalog: "team", name: "skill-a" }]),
          bundleWithRequires("agent-b", [{ name: "skill-b" }]),
        ],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async (ref: string) => {
        installCalls.push(ref);
      },
      prompt: async () => "y",
      skillMode: "with-skills",
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(installCalls.sort()).toEqual(["skill-b", "team/skill-a"]);
  });

  test("--no-skills: skips skills for every agent and warns about each", async () => {
    const installCalls: string[] = [];
    const printed: string[] = [];
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          bundleWithRequires("agent-a", [{ name: "skill-a" }]),
          bundleWithRequires("agent-b", [{ name: "skill-b" }]),
        ],
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
    expect(printed.some((m) => /skill-a/.test(m) && /may not function/.test(m))).toBe(true);
    expect(printed.some((m) => /skill-b/.test(m) && /may not function/.test(m))).toBe(true);
  });

  test("throws partial-failure when a bundle failed to load but loaded subset succeeded", async () => {
    const printedErr: string[] = [];
    let caught: unknown;
    try {
      await installAll({
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [fakeBundle("good", { targets: ["opencode"] })],
          failures: [
            {
              sourceKind: "user-global",
              sourceLabel: "user",
              bundlePath: "/fake/bad",
              reason: "schema bork",
            },
          ],
        }),
        buildAndInstall: async () => emptyResult,
        loadInstalledSkillNames: async () => [],
        installSkillByRef: async () => {},
        prompt: async () => "y",
        print: () => {},
        printErr: (m) => printedErr.push(m),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("partial-failure");
    if (payload.code === "partial-failure") {
      expect(payload.operation).toBe("install all");
      expect(payload.succeeded).toBe(1);
      expect(payload.failed).toBe(1);
      expect(payload.skipped).toBe(0);
      expect(
        payload.details.some((d) => d.includes("/fake/bad") && d.includes("schema bork")),
      ).toBe(true);
    }
    // Warning printed at top level via printErr.
    expect(printedErr.some((m) => /\/fake\/bad/.test(m) && /schema bork/.test(m))).toBe(true);
  });

  test("does NOT throw partial-failure when an inner install errored (existing exit signal dominates)", async () => {
    const printedErr: string[] = [];
    let callCount = 0;
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("good1", { targets: ["opencode"] }),
          fakeBundle("good2", { targets: ["opencode"] }),
        ],
        failures: [
          {
            sourceKind: "user-global",
            sourceLabel: "user",
            bundlePath: "/fake/bad",
            reason: "schema bork",
          },
        ],
      }),
      buildAndInstall: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { ...emptyResult, errors: [{ agent: "good1", messages: ["boom"] }] };
        }
        return emptyResult;
      },
      loadInstalledSkillNames: async () => [],
      installSkillByRef: async () => {},
      prompt: async () => "y",
      print: () => {},
      printErr: (m) => printedErr.push(m),
    });
    expect(code).not.toBe(0); // exit-code dominates
    // Load failure was still printed at top level.
    expect(printedErr.some((m) => /\/fake\/bad/.test(m))).toBe(true);
  });

  test("'Installed 0 files' when truly empty (no bundles AND no failures)", async () => {
    const printed: string[] = [];
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      buildAndInstall: async () => emptyResult,
      print: (m) => printed.push(m),
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(printed.some((m) => /Installed 0 files/.test(m))).toBe(true);
  });
});
