import { describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
};

// Hermetic knowledge paths so plan + remove don't touch the real user home.
// Subdir under tmpdir() that we never create — knowledge dir is plan-stat'd
// (returns exists=false, no "→ remove" verb for the knowledge row) and
// removeBundleKnowledge ENOENTs cleanly (knowledgeNotFound=true, suppressed
// in the no-deps case where we don't render the not-found line).
const knowledgePaths = { agentSmithHome: "/fake/non-existent-agent-smith-home" };

describe("cli/uninstall runUninstallCli", () => {
  test("unknown agent name throws not-found SmithError", async () => {
    let caught: unknown;
    try {
      await runUninstallCli({
        name: "nonexistent",
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        print: () => {},
        rmFile: async () => {
          throw new Error("rmFile should not be called");
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("not-found");
    if (e.payload.code === "not-found") {
      expect(e.payload.identifier).toBe("nonexistent");
    }
  });

  test("happy path: 3 targets all removed, exit 0, prints 3 removed lines", async () => {
    const printed: string[] = [];
    const calls: string[] = [];
    const code = await runUninstallCli({
      name: "foo",
      paths,
      knowledgePaths,
      // statFile returning success → plan shows targets as "installed" → "→ remove" verb.
      statFile: async () => ({}),
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] })],
        failures: [],
      }),
      print: (m) => printed.push(m),
      rmFile: async (p) => {
        calls.push(p);
      },
      // No-op rmDir: knowledge dir doesn't exist on disk anyway, but installed
      // tests should not depend on real fs for knowledge cleanup.
      rmDir: async () => {},
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/claude/agents/foo.md",
      "/fake/agents/skills/foo/SKILL.md",
    ]);
    const removedLines = printed.filter((m) => m.includes("removed:"));
    // 3 platform files + 1 knowledge dir (rmDir no-op succeeds → knowledgeRemoved=true).
    expect(removedLines).toHaveLength(4);
    // Spec: removed lines appear in target-declaration order.
    expect(removedLines[0]).toContain("/fake/opencode/agents/foo.md");
    expect(removedLines[1]).toContain("/fake/claude/agents/foo.md");
    expect(removedLines[2]).toContain("/fake/agents/skills/foo/SKILL.md");
    // Plan table is printed before the removal results.
    const joined = printed.join("\n");
    expect(joined).toContain("opencode");
    expect(joined).toContain("claude-code");
    expect(joined).toContain("codex");
    expect(joined).toContain("knowledge");
    expect(joined).toContain("→ remove");
  });

  test("mixed: 2 removed + 1 not-found, exit 0", async () => {
    const printed: string[] = [];
    let count = 0;
    const code = await runUninstallCli({
      name: "foo",
      paths,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] })],
        failures: [],
      }),
      print: (m) => printed.push(m),
      rmFile: async (_p) => {
        count++;
        if (count === 2) {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
      },
      // Knowledge dir doesn't exist → rmDir gets ENOENT → knowledgeNotFound=true
      // → produces an extra "not found:" line below.
      rmDir: async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    });
    expect(code).toBe(0);
    const notFoundLines = printed.filter((m) => m.includes("not found:"));
    const removedLines = printed.filter((m) => m.includes("removed:"));
    // 1 platform not-found + 1 knowledge not-found.
    expect(notFoundLines).toHaveLength(2);
    expect(notFoundLines[0]).toContain("/fake/claude/agents/foo.md");
    expect(removedLines).toHaveLength(2);
    expect(removedLines[0]).toContain("/fake/opencode/agents/foo.md");
    expect(removedLines[1]).toContain("/fake/agents/skills/foo/SKILL.md");
    // Spec ordering: removed group printed before notFound group.
    const firstRemoved = printed.findIndex((m) => m.includes("removed:"));
    const firstNotFound = printed.findIndex((m) => m.includes("not found:"));
    expect(firstRemoved).toBeLessThan(firstNotFound);
  });

  test("filesystem error returns exit 3 but still attempts the others", async () => {
    const printed: string[] = [];
    const errs: string[] = [];
    const calls: string[] = [];
    let count = 0;
    const code = await runUninstallCli({
      name: "foo",
      paths,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code", "codex"] })],
        failures: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => errs.push(m),
      rmFile: async (p) => {
        calls.push(p);
        count++;
        if (count === 1) {
          const err = new Error("permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        }
      },
      rmDir: async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    });
    expect(code).toBe(3);
    expect(calls).toEqual([
      "/fake/opencode/agents/foo.md",
      "/fake/claude/agents/foo.md",
      "/fake/agents/skills/foo/SKILL.md",
    ]);
    // CLI-18: failure lines go to stderr (not stdout), matching install's
    // behavior. Both commands share the red-✗ + exit 3 contract for
    // filesystem failures, so they must use the same stream.
    expect(printed.filter((m) => m.includes("failed:"))).toHaveLength(0);
    const failedLines = errs.filter((m) => m.includes("failed:"));
    expect(failedLines).toHaveLength(1);
    expect(failedLines[0]).toContain("/fake/opencode/agents/foo.md");
    expect(failedLines[0]).toContain("permission denied");
  });

  test("--dry-run prints plan table, never calls rmFile, exit 0", async () => {
    const printed: string[] = [];
    let rmCalled = false;
    const code = await runUninstallCli({
      name: "foo",
      paths,
      knowledgePaths,
      dryRun: true,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("foo", { targets: ["opencode", "claude-code"] })],
        failures: [],
      }),
      statFile: async () => {},
      print: (m) => printed.push(m),
      rmFile: async () => {
        rmCalled = true;
      },
    });
    expect(code).toBe(0);
    expect(rmCalled).toBe(false);
    const joined = printed.join("\n");
    // Plan header references the bundle.
    expect(joined).toContain("foo");
    // Per-target rows render with target name + status + verb.
    expect(joined).toContain("opencode");
    expect(joined).toContain("claude-code");
    expect(joined).toContain("installed");
    expect(joined).toContain("→ remove");
    // Knowledge row appears.
    expect(joined).toContain("knowledge");
    // Final dry-run footer.
    expect(joined).toContain("DRY RUN — no changes made.");
    // No removal lines emitted in dry-run.
    expect(printed.filter((m) => m.includes("✓ removed:"))).toHaveLength(0);
  });

  test("removes the knowledge dir when it exists on disk", async () => {
    const tmpHome = join(tmpdir(), `uninst-cli-kn-${Math.random().toString(36).slice(2)}`);
    const knowledgeDir = join(tmpHome, "knowledge", "test-bundle");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, "index.md"), "x");

    const output: string[] = [];
    const code = await runUninstallCli({
      name: "test-bundle",
      paths,
      knowledgePaths: { agentSmithHome: tmpHome },
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("test-bundle", { targets: ["opencode"] })],
        failures: [],
      }),
      // platform file no-op (it doesn't exist on disk; treat as removed)
      rmFile: async () => {},
      print: (m) => output.push(m),
      printErr: (m) => output.push(m),
    });

    const joined = output.join("\n");
    expect(code).toBe(0);
    expect(joined).toContain("knowledge");
    expect(joined).toContain("installed");
    expect(joined).toContain(`✓ removed: ${knowledgeDir}`);
    const stillExists = await stat(knowledgeDir).then(() => true).catch(() => false);
    expect(stillExists).toBe(false);

    await rm(tmpHome, { recursive: true, force: true });
  });

  test("throws partial-failure when target bundle failed to load", async () => {
    let caught: unknown;
    try {
      await runUninstallCli({
        name: "foo",
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({
          bundles: [],
          failures: [
            {
              sourceKind: "user-global" as const,
              sourceLabel: "test",
              bundlePath: "/cat/foo",
              reason: "config invalid",
            },
          ],
        }),
        print: () => {},
        printErr: () => {},
        rmFile: async () => {
          throw new Error("rmFile should not be called");
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("partial-failure");
    if (e.payload.code === "partial-failure") {
      expect(e.payload.failed).toBe(1);
      expect(e.payload.details[0]).toContain("foo");
      expect(e.payload.details[0]).toContain("config invalid");
    }
  });

  test("prints unrelated load failures as warnings then proceeds with target", async () => {
    const warnings: string[] = [];
    const printed: string[] = [];
    const code = await runUninstallCli({
      name: "good",
      paths,
      knowledgePaths: { agentSmithHome: "/fake/non-existent-agent-smith-home" },
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("good", { targets: ["opencode"] })],
        failures: [
          {
            sourceKind: "user-global" as const,
            sourceLabel: "test",
            bundlePath: "/cat/other",
            reason: "boom",
          },
        ],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => warnings.push(m),
      rmFile: async () => {},
      rmDir: async () => {},
    });
    expect(code).toBe(0);
    expect(warnings.some((w) => w.includes("/cat/other") && w.includes("boom"))).toBe(true);
  });
});
