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

describe("install CLI: --platforms filter", () => {
  test("restricts targets to the intersection when filter overlaps declared targets", async () => {
    let recordedTargets: string[] | undefined;
    const bundle = fakeBundle("foo", { targets: ["opencode", "codex", "claude-code"] });
    const code = await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: async (bundles: AgentBundle[]) => {
        const first = bundles[0];
        if (!first) throw new Error("expected at least one bundle");
        recordedTargets = [...first.config.targets];
        return emptyResult;
      },
      platformFilter: ["opencode"],
      noRefreshHooks: true,
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(recordedTargets).toEqual(["opencode"]);
  });

  test("errors with usage-error when filter has no overlap with declared targets", async () => {
    let buildCalled = false;
    const bundle = fakeBundle("foo", { targets: ["opencode"] });
    await expect(
      install({
        name: "foo",
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
        buildAndInstall: async () => {
          buildCalled = true;
          return emptyResult;
        },
        platformFilter: ["codex"],
        noRefreshHooks: true,
        print: () => {},
        printErr: () => {},
      }),
    ).rejects.toMatchObject({ code: "usage-error" });
    expect(buildCalled).toBe(false);
  });

  test("does not change behavior when platformFilter is undefined", async () => {
    let recordedTargets: string[] | undefined;
    const bundle = fakeBundle("foo", { targets: ["opencode", "codex"] });
    const code = await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [bundle], failures: [] }),
      buildAndInstall: async (bundles: AgentBundle[]) => {
        const first = bundles[0];
        if (!first) throw new Error("expected at least one bundle");
        recordedTargets = [...first.config.targets];
        return emptyResult;
      },
      noRefreshHooks: true,
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(recordedTargets).toEqual(["opencode", "codex"]);
  });
});
