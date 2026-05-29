import { describe, expect, test } from "bun:test";
import { installAll } from "../../src/cli/commands/install-all";
import type { InstallPaths } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";
import type { OrchestratorResult } from "../../src/io/orchestrator";
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

describe("cli/install-all: --platforms filter", () => {
  test("filters per-bundle and skips with warn when a bundle has no overlap", async () => {
    const a = fakeBundle("agent-a", { targets: ["opencode"] });
    const b = fakeBundle("agent-b", { targets: ["codex"] });
    const seen: { name: string; targets: string[] }[] = [];
    const warnings: string[] = [];
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [a, b], failures: [] }),
      buildAndInstall: async (bundles): Promise<OrchestratorResult> => {
        const [first] = bundles;
        if (!first) throw new Error("expected at least one bundle");
        seen.push({
          name: first.config.name,
          targets: [...first.config.targets],
        });
        return emptyResult;
      },
      platformFilter: ["opencode"],
      print: () => {},
      printErr: (m) => warnings.push(m),
    });
    expect(code).toBe(0);
    expect(seen).toEqual([{ name: "agent-a", targets: ["opencode"] }]);
    // agent-b should be reported as skipped via stderr warn
    expect(
      warnings.some(
        (w) =>
          w.includes("agent-b") &&
          w.includes("opencode") &&
          w.includes("declared") &&
          w.includes("codex"),
      ),
    ).toBe(true);
  });
});
