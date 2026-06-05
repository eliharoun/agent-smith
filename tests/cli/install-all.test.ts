import { describe, expect, test } from "bun:test";
import { installAll } from "../../src/cli/commands/install-all";
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

describe("cli/install-all: platform detection — write gating", () => {
  test("does not pass undetected platforms to buildAndInstall for any bundle", async () => {
    // Two bundles, each with all four CLI-bound targets plus agents-md.
    // Only claude-code is detected on PATH. Each bundle must reach
    // buildAndInstall narrowed to {claude-code, agents-md} — no speculative
    // writes for opencode/codex/kiro paths.
    const bundleA = fakeBundle("agent-a", {
      targets: ["opencode", "claude-code", "codex", "kiro", "agents-md"],
    });
    const bundleB = fakeBundle("agent-b", {
      targets: ["opencode", "claude-code", "codex", "kiro", "agents-md"],
    });
    const seen: { name: string; targets: string[] }[] = [];
    const errs: string[] = [];
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [bundleA, bundleB], failures: [] }),
      buildAndInstall: async (bundles: AgentBundle[]): Promise<OrchestratorResult> => {
        const [first] = bundles;
        if (!first) throw new Error("expected at least one bundle");
        seen.push({
          name: first.config.name,
          targets: [...first.config.targets],
        });
        return emptyResult;
      },
      detectInstalledPlatforms: async () => new Set(["claude-code"] as const),
      print: () => {},
      printErr: (m) => errs.push(m),
    });
    expect(code).toBe(0);
    expect(seen).toHaveLength(2);
    // Every bundle keeps the detected CLI target + agents-md, drops the rest.
    for (const entry of seen) {
      expect(entry.targets).toContain("claude-code");
      expect(entry.targets).toContain("agents-md");
      expect(entry.targets).not.toContain("opencode");
      expect(entry.targets).not.toContain("codex");
      expect(entry.targets).not.toContain("kiro");
    }
    // Skip one-liner reaches stderr for each undetected platform per bundle.
    const allErr = errs.join("\n");
    expect(allErr).toMatch(/opencode.*not detected/);
    expect(allErr).toMatch(/codex.*not detected/);
    expect(allErr).toMatch(/kiro.*not detected/);
  });

  test("detection runs once and is reused across bundles", async () => {
    // Inject a counter on the DI seam so we can prove the detection
    // function is invoked exactly once for the whole installAll run, not
    // once-per-bundle.
    let detectCalls = 0;
    const detect = async (): Promise<Set<"opencode" | "claude-code" | "codex" | "kiro">> => {
      detectCalls += 1;
      return new Set(["claude-code"] as const);
    };
    const code = await installAll({
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("a", { targets: ["claude-code"] }),
          fakeBundle("b", { targets: ["claude-code"] }),
          fakeBundle("c", { targets: ["claude-code"] }),
        ],
        failures: [],
      }),
      buildAndInstall: async () => emptyResult,
      detectInstalledPlatforms: detect,
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(detectCalls).toBe(1);
  });
});
