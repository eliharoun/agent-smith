import { describe, expect, test } from "bun:test";
import { runUninstallAllCli } from "../../src/cli/commands/uninstall-all";
import type { InstallPaths } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
};
const knowledgePaths = { agentSmithHome: "/fake/non-existent-agent-smith-home" };

describe("cli/uninstall-all: --platforms filter", () => {
  test("filters per bundle and skips bundles with no overlap (warn)", async () => {
    const messages: string[] = [];
    const removedFiles: string[] = [];
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      statFile: async () => ({}),
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("a", { targets: ["opencode", "codex"] }),
          fakeBundle("b", { targets: ["claude-code"] }),
        ],
        failures: [],
      }),
      rmFile: async (p: string) => {
        removedFiles.push(p);
      },
      rmDir: async () => {},
      platformFilter: ["opencode"],
      yes: true,
      print: (m: string) => messages.push(m),
    });
    expect(code).toBe(0);
    // Bundle b has no overlap → must surface a "skip" message mentioning b.
    expect(
      messages.some((m) => m.includes("b") && m.toLowerCase().includes("skip")),
    ).toBe(true);
    // Bundle a → only opencode file is removed; claude/codex paths untouched.
    expect(removedFiles).toContain("/fake/opencode/agents/a.md");
    expect(removedFiles.some((p) => p.startsWith("/fake/claude/agents"))).toBe(false);
    expect(removedFiles.some((p) => p.startsWith("/fake/agents/skills"))).toBe(false);
  });

  test("preserves shared knowledge dir for partially-uninstalled bundles", async () => {
    // Real fs setup so removeBundle's partialRemoval branch is exercised
    // end-to-end: knowledge dir must survive when only one of multiple
    // declared targets is being uninstalled.
    const { mkdtemp, mkdir, writeFile, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "smith-uninst-all-pf-"));
    const agentSmithHome = join(root, ".agent-smith");
    await mkdir(join(agentSmithHome, "knowledge", "a"), { recursive: true });
    await writeFile(join(agentSmithHome, "knowledge", "a", "k.md"), "k", "utf8");
    await mkdir(join(root, "opencode"), { recursive: true });
    await writeFile(join(root, "opencode", "a.md"), "x", "utf8");

    const code = await runUninstallAllCli({
      paths: {
        opencode: join(root, "opencode"),
        "claude-code": join(root, "claude"),
        codex: join(root, "codex"),
        kiro: join(root, "kiro")
      },
      knowledgePaths: { agentSmithHome },
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("a", { targets: ["opencode", "claude-code"] })],
        failures: [],
      }),
      platformFilter: ["opencode"],
      yes: true,
      print: () => {},
    });
    expect(code).toBe(0);
    // Knowledge sentinel survives — claude-code still relies on it.
    const k = await readFile(join(agentSmithHome, "knowledge", "a", "k.md"), "utf8");
    expect(k).toBe("k");
  });
});
