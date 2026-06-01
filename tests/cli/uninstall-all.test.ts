import { describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUninstallAllCli } from "../../src/cli/commands/uninstall-all";
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

// Hermetic knowledge paths so plan + remove don't touch the real user home.
const knowledgePaths = { agentSmithHome: "/fake/non-existent-agent-smith-home" };
// No-op rmDir for tests where knowledge dir doesn't exist on disk; the
// uninstaller swallows ENOENT so a no-op (success) means knowledgeRemoved=true,
// and knowledge results are NOT printed in uninstall-all (only the per-bundle
// table at the top mentions them — see Task 11 tradeoff).
const noopRmDir = async () => {};

describe("cli/uninstall-all runUninstallAllCli", () => {
  test("empty registry → exit 0, no prompt, message printed (truly empty: bundles=[] && failures=[])", async () => {
    const printed: string[] = [];
    let promptCalled = false;
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => {
        promptCalled = true;
        return "";
      },
      rmFile: async () => {},
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    expect(promptCalled).toBe(false);
    expect(printed.length).toBe(1);
    expect(printed[0]).toBe("No agents registered.");
  });

  test("plan output renders per-bundle table with knowledge rows", async () => {
    const printed: string[] = [];
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("foo", { targets: ["opencode"] }),
          fakeBundle("bar", { targets: ["claude-code", "codex"] }),
        ],
        failures: [],
      }),
      print: (m) => printed.push(m),
      rmFile: async () => {},
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    const joined = printed.join("\n");
    // Plan summary header.
    expect(joined).toContain("Plan: 2 agents");
    // Per-bundle headers (perBundleHeader: true → `"<name>":`).
    expect(joined).toContain('"foo":');
    expect(joined).toContain('"bar":');
    // Per-target rows.
    expect(joined).toContain("opencode");
    expect(joined).toContain("claude-code");
    expect(joined).toContain("codex");
    // Knowledge row appears for each bundle.
    expect(printed.filter((m) => m.includes("knowledge"))).toHaveLength(2);
    // Status verb.
    expect(joined).toContain("→ remove");
    // Action header.
    expect(joined).toContain("Removing 2 agents");
    // Footer line is the last printed message.
    expect(printed[printed.length - 1]).toBe(
      "Removed 3 files. Source bundles remain registered.",
    );
  });

  test("removes the knowledge dir for at least one bundle when present on disk", async () => {
    const tmpHome = join(tmpdir(), `uninst-all-cli-kn-${Math.random().toString(36).slice(2)}`);
    const fooKn = join(tmpHome, "knowledge", "foo");
    const barKn = join(tmpHome, "knowledge", "bar");
    await mkdir(fooKn, { recursive: true });
    await writeFile(join(fooKn, "index.md"), "x");
    await mkdir(barKn, { recursive: true });
    await writeFile(join(barKn, "index.md"), "y");

    const code = await runUninstallAllCli({
      paths,
      knowledgePaths: { agentSmithHome: tmpHome },
      yes: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("foo", { targets: ["opencode"] }),
          fakeBundle("bar", { targets: ["claude-code"] }),
        ],
        failures: [],
      }),
      print: () => {},
      rmFile: async () => {},
      // Use real rmDir (default) by not overriding.
    });
    expect(code).toBe(0);
    // Both knowledge dirs must be removed on disk.
    const fooStill = await stat(fooKn).then(() => true).catch(() => false);
    const barStill = await stat(barKn).then(() => true).catch(() => false);
    expect(fooStill).toBe(false);
    expect(barStill).toBe(false);

    await rm(tmpHome, { recursive: true, force: true });
  });

  test("prompt declined (n) → exit 1, rmFile never called, prints Aborted.", async () => {
    const printed: string[] = [];
    let rmCalled = false;
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo", { targets: ["opencode"] })], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "n",
      rmFile: async () => {
        rmCalled = true;
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(1);
    expect(rmCalled).toBe(false);
    // Aborted line is the final user-visible message before exit.
    expect(printed[printed.length - 1]).toBe("Aborted.");
  });

  test("prompt empty (default N) → exit 1, rmFile never called, prints Aborted.", async () => {
    const printed: string[] = [];
    let rmCalled = false;
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo", { targets: ["opencode"] })], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => "",
      rmFile: async () => {
        rmCalled = true;
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(1);
    expect(rmCalled).toBe(false);
    expect(printed[printed.length - 1]).toBe("Aborted.");
  });

  test("prompt accepted (y) → all bundles processed", async () => {
    const calls: string[] = [];
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("foo", { targets: ["opencode"] }),
          fakeBundle("bar", { targets: ["claude-code"] }),
        ],
        failures: [],
      }),
      print: () => {},
      readToken: async () => "y",
      rmFile: async (p) => {
        calls.push(p);
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/claude/agents/bar.md",
    ]);
  });

  test("--yes skips the prompt entirely", async () => {
    let promptCalled = false;
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo", { targets: ["opencode"] })], failures: [] }),
      print: () => {},
      readToken: async () => {
        promptCalled = true;
        return "y";
      },
      rmFile: async () => {},
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    expect(promptCalled).toBe(false);
  });

  test("--dry-run skips both prompt and removal", async () => {
    const printed: string[] = [];
    let promptCalled = false;
    let rmCalled = false;
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      dryRun: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo", { targets: ["opencode"] })], failures: [] }),
      print: (m) => printed.push(m),
      readToken: async () => {
        promptCalled = true;
        return "y";
      },
      rmFile: async () => {
        rmCalled = true;
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    expect(promptCalled).toBe(false);
    expect(rmCalled).toBe(false);
    const joined = printed.join("\n");
    // Plan grammar pluralizes correctly for n=1.
    expect(joined).toContain("Plan: 1 agent");
    expect(joined).toContain('"foo":');
    expect(joined).toContain("opencode");
    expect(joined).toContain("knowledge");
    expect(joined).toContain("DRY RUN — no changes made.");
  });

  test("uppercase Y / YES / Yes are accepted (case-insensitive)", async () => {
    for (const answer of ["Y", "YES", "Yes", "yEs"]) {
      const calls: string[] = [];
      const code = await runUninstallAllCli({
        paths,
        knowledgePaths,
        statFile: async () => {},
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [fakeBundle("foo", { targets: ["opencode"] })], failures: [] }),
        print: () => {},
        readToken: async () => answer,
        rmFile: async (p) => {
          calls.push(p);
        },
        rmDir: noopRmDir,
      });
      expect(code, `answer=${answer}`).toBe(0);
      expect(calls, `answer=${answer}`).toEqual(["/fake/opencode/agents/foo.md"]);
    }
  });

  test("mixed result types (removed + notFound + failed) prints all three groups, exit 3", async () => {
    const printed: string[] = [];
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      yes: true,
      statFile: async () => {},
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [
          fakeBundle("ok", { targets: ["opencode"] }),
          fakeBundle("missing", { targets: ["claude-code"] }),
          fakeBundle("denied", { targets: ["codex"] }),
        ],
        failures: [],
      }),
      print: (m) => printed.push(m),
      rmFile: async (p) => {
        if (p.includes("missing")) {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        if (p.includes("denied")) {
          const err = new Error("permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        }
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(3); // any errors → exit 3 (EXIT_PARTIAL)
    const removedLines = printed.filter((m) => m.includes("removed:"));
    const notFoundLines = printed.filter((m) => m.includes("not found:"));
    const failedLines = printed.filter((m) => m.includes("failed:"));
    expect(removedLines).toHaveLength(1);
    expect(notFoundLines).toHaveLength(1);
    expect(failedLines).toHaveLength(1);
    expect(removedLines[0]).toContain("/fake/opencode/agents/ok.md");
    expect(notFoundLines[0]).toContain("/fake/claude/agents/missing.md");
    expect(failedLines[0]).toContain("/fake/agents/skills/denied/SKILL.md");
    expect(failedLines[0]).toContain("permission denied");
    // Footer reports only the successfully removed count.
    expect(printed[printed.length - 1]).toBe(
      "Removed 1 file. Source bundles remain registered.",
    );
  });

  test("warns load failures and continues with loaded bundles", async () => {
    const printed: string[] = [];
    const calls: string[] = [];
    const code = await runUninstallAllCli({
      paths,
      knowledgePaths,
      yes: true,
      statFile: async () => {},
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
      print: (m) => printed.push(m),
      rmFile: async (p) => {
        calls.push(p);
      },
      rmDir: noopRmDir,
    });
    expect(code).toBe(0);
    // Warning printed for the bad bundle.
    expect(printed.some((m) => /warn:/.test(m) && /\/fake\/bad/.test(m) && /schema bork/.test(m))).toBe(true);
    // Good bundle still got planned + removed.
    expect(calls).toEqual(["/fake/opencode/agents/good.md"]);
  });
});
