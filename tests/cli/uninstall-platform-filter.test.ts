import { describe, expect, test } from "bun:test";
import { runUninstallCli } from "../../src/cli/commands/uninstall";
import { SmithError } from "../../src/core/smith-error";
import type { InstallPaths } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
  "agents-md": "/fake/agents-md/agents",
};
const knowledgePaths = { agentSmithHome: "/fake/non-existent-agent-smith-home" };

describe("cli/uninstall: --platforms filter", () => {
  test("restricts uninstall scope to intersection of declared targets and filter", async () => {
    const removedFiles: string[] = [];
    const code = await runUninstallCli({
      name: "foo",
      paths,
      knowledgePaths,
      statFile: async () => ({}),
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] })],
        failures: [],
      }),
      print: () => {},
      printErr: () => {},
      rmFile: async (p: string) => {
        removedFiles.push(p);
      },
      rmDir: async () => {},
      platformFilter: ["opencode"],
    });
    expect(code).toBe(0);
    expect(removedFiles).toContain("/fake/opencode/agents/foo.md");
    expect(removedFiles.some((p) => p.startsWith("/fake/claude/agents"))).toBe(false);
    expect(removedFiles.some((p) => p.startsWith("/fake/agents/skills"))).toBe(false);
  });

  test("errors with usage-error when filter has no overlap with declared targets", async () => {
    let rmCalled = false;
    let caught: unknown;
    try {
      await runUninstallCli({
        name: "foo",
        paths,
        knowledgePaths,
        statFile: async () => ({}),
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [fakeBundle("foo", { targets: ["opencode"] })],
          failures: [],
        }),
        print: () => {},
        printErr: () => {},
        rmFile: async () => {
          rmCalled = true;
        },
        rmDir: async () => {},
        platformFilter: ["codex"],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("usage-error");
    expect(rmCalled).toBe(false);
  });

  test("forwards partialRemoval to removeBundle when filter is a strict subset", async () => {
    // Use a real temp dir so removeBundle's partialRemoval branch is exercised
    // end-to-end: knowledge dir must survive when only one of multiple
    // declared targets is being uninstalled.
    const { mkdtemp, mkdir, writeFile, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "smith-uninst-pf-"));
    const agentSmithHome = join(root, ".agent-smith");
    await mkdir(join(agentSmithHome, "knowledge", "foo"), { recursive: true });
    await writeFile(join(agentSmithHome, "knowledge", "foo", "k.md"), "k", "utf8");
    await mkdir(join(root, "opencode"), { recursive: true });
    await writeFile(join(root, "opencode", "foo.md"), "x", "utf8");

    const code = await runUninstallCli({
      name: "foo",
      paths: {
        opencode: join(root, "opencode"),
        "claude-code": join(root, "claude"),
        codex: join(root, "codex"),
        kiro: join(root, "kiro"),
        "agents-md": join(root, "agents-md")
      },
      knowledgePaths: { agentSmithHome },
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code"] })],
        failures: [],
      }),
      platformFilter: ["opencode"],
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    // Knowledge sentinel must survive — claude-code still depends on it.
    const k = await readFile(join(agentSmithHome, "knowledge", "foo", "k.md"), "utf8");
    expect(k).toBe("k");
  });
});
