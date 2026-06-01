import { describe, expect, test } from "bun:test";
import { runDestroyAgentCli } from "../../src/cli/commands/destroy-agent";
import { SmithError } from "../../src/core/smith-error";
import type { InstallPaths } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";
import { fakeBundle } from "../_helpers/fakeBundle";

const paths: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/codex/skills",
  kiro: "/fake/kiro/skills",
  "agents-md": "/fake/agents-md/skills",
};

const FAKE_CONFIG = "/fake/config/agent-smith";
const OWNED_ROOT = `${FAKE_CONFIG}/agents`;

// Hermetic knowledge paths so plan + remove don't touch the real user home.
const knowledgePaths = { agentSmithHome: "/fake/non-existent-agent-smith-home" };

describe("cli/destroy-agent runDestroyAgentCli", () => {
  test("not-found: throws not-found SmithError when no bundle matches name", async () => {
    const err = await runDestroyAgentCli({
      name: "ghost",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [], failures: [] }),
      print: () => {},
      printErr: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("agent");
    expect(err.payload.identifier).toBe("ghost");
  });

  test("ownership refusal: non user-global bundle is refused with validation error", async () => {
    const external = fakeBundle("jira-helper", {
      kind: "registered",
      rootPath: "/fake/skills/path",
    });
    const err = await runDestroyAgentCli({
      name: "jira-helper",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [external], failures: [] }),
      print: () => {},
      printErr: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    const reasons: string[] = err.payload.reasons;
    expect(reasons.some((r) => r.includes("not managed by agent-smith"))).toBe(true);
  });

  test("ownership refusal: user-global but rootPath outside configDir is refused", async () => {
    const stray = fakeBundle("stray", { kind: "user-global", rootPath: "/some/other/place" });
    const err = await runDestroyAgentCli({
      name: "stray",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [stray], failures: [] }),
      print: () => {},
      printErr: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    const reasons: string[] = err.payload.reasons;
    expect(reasons.some((r) => r.includes("not managed by agent-smith"))).toBe(true);
  });

  test("confirmation: typed-token mismatch aborts with no removals", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode"],
    });
    const rmFileCalls: string[] = [];
    const rmSourceDirCalls: string[] = [];
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      rmFile: async (p: string) => {
        rmFileCalls.push(p);
      },
      rmSourceDir: async (p: string) => {
        rmSourceDirCalls.push(p);
      },
      // Knowledge cleanup no-op (separate hook from rmSourceDir).
      rmDir: async () => {},
      readToken: async () => "wrong-token",
      print: () => {},
      printErr: () => {},
    });
    expect(code).not.toBe(0);
    expect(rmFileCalls).toEqual([]);
    expect(rmSourceDirCalls).toEqual([]);
  });

  test("dry-run: per-target install table with friendly paths, no raw absolute paths in body", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode", "claude-code", "codex"],
    });
    const lines: string[] = [];
    const rmFileCalls: string[] = [];
    const rmSourceDirCalls: string[] = [];

    // Mixed install state: opencode + codex installed, claude-code missing
    const installed = new Set([
      "/fake/opencode/agents/my-debugger.md",
      "/fake/codex/skills/my-debugger/SKILL.md",
    ]);
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      dryRun: true,
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      homeDir: "/fake/home",
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async (p: string) => {
        if (installed.has(p)) return {};
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      rmFile: async (p: string) => {
        rmFileCalls.push(p);
      },
      rmSourceDir: async (p: string) => {
        rmSourceDirCalls.push(p);
      },
      // Knowledge cleanup no-op (separate hook from rmSourceDir).
      rmDir: async () => {},
      print: (m: string) => lines.push(m),
      printErr: () => {},
    });

    expect(code).toBe(0);
    expect(rmFileCalls).toEqual([]);
    expect(rmSourceDirCalls).toEqual([]);
    const out = lines.join("\n");

    expect(out).toContain("my-debugger");

    expect(out).toContain("opencode");
    expect(out).toContain("claude-code");
    expect(out).toContain("codex");
    // Shared renderer adds a knowledge row.
    expect(out).toContain("knowledge");

    expect(out.toLowerCase()).toContain("uninstall");
    expect(out.toLowerCase()).toContain("no action");

    expect(out.toLowerCase()).toContain("dry run");

    expect(out).not.toContain("/fake/opencode/agents/my-debugger.md");
    expect(out).not.toContain("/fake/claude/agents/my-debugger.md");
    expect(out).not.toContain("/fake/codex/skills/my-debugger/SKILL.md");
  });

  test("refuses if rendered files exist without --force (validation error mentioning --force)", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode"],
    });
    const rmFileCalls: string[] = [];
    const rmSourceDirCalls: string[] = [];
    const err = await runDestroyAgentCli({
      name: "my-debugger",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => ({}),
      rmFile: async (p: string) => {
        rmFileCalls.push(p);
      },
      rmSourceDir: async (p: string) => {
        rmSourceDirCalls.push(p);
      },
      // Knowledge cleanup no-op (separate hook from rmSourceDir).
      rmDir: async () => {},
      readToken: async () => "my-debugger",
      print: () => {},
      printErr: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    const reasons: string[] = err.payload.reasons;
    expect(reasons.some((r) => r.includes("dangling agent definitions"))).toBe(true);
    expect(reasons.some((r) => r.includes("--force"))).toBe(true);
    expect(err.payload.suggestedCommand).toBe(`smith agent destroy my-debugger --force`);
    expect(rmFileCalls).toEqual([]);
    expect(rmSourceDirCalls).toEqual([]);
  });

  test("--force: chains uninstall (rmFile per rendered) then deletes source dir", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode", "claude-code"],
    });
    const rmFileCalls: string[] = [];
    const rmSourceDirCalls: string[] = [];
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      force: true,
      yes: true,
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => ({}),
      rmFile: async (p: string) => {
        rmFileCalls.push(p);
      },
      rmSourceDir: async (p: string) => {
        rmSourceDirCalls.push(p);
      },
      // Knowledge cleanup no-op (separate hook from rmSourceDir).
      rmDir: async () => {},
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(rmFileCalls).toContain("/fake/opencode/agents/my-debugger.md");
    expect(rmFileCalls).toContain("/fake/claude/agents/my-debugger.md");
    expect(rmSourceDirCalls).toContain(`${OWNED_ROOT}/my-debugger`);
  });

  test("clean uninstalled: deletes source dir without --force when no rendered files exist", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode"],
    });
    const rmFileCalls: string[] = [];
    const rmSourceDirCalls: string[] = [];
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      yes: true,
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      rmFile: async (p: string) => {
        rmFileCalls.push(p);
      },
      rmSourceDir: async (p: string) => {
        rmSourceDirCalls.push(p);
      },
      // Knowledge cleanup no-op (separate hook from rmSourceDir).
      rmDir: async () => {},
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(rmFileCalls).toEqual([]);
    expect(rmSourceDirCalls).toContain(`${OWNED_ROOT}/my-debugger`);
  });

  test("confirmation token: prompts for the agent name (not 'destroy <name>'); typing the name proceeds", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode"],
    });
    let promptShown = "";
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      rmFile: async () => {},
      rmSourceDir: async () => {},
      rmDir: async () => {},
      readToken: async (prompt: string) => {
        promptShown = prompt;
        return "my-debugger";
      },
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(promptShown).toContain("my-debugger");
    expect(promptShown).not.toContain("destroy my-debugger");
  });

  test("--yes: bypasses confirmation (readToken never called)", async () => {
    const owned = fakeBundle("my-debugger", {
      kind: "user-global",
      rootPath: OWNED_ROOT,
      bundlePath: `${OWNED_ROOT}/my-debugger`,
      targets: ["opencode"],
    });
    let readTokenCalls = 0;
    const code = await runDestroyAgentCli({
      name: "my-debugger",
      yes: true,
      paths,
      configDir: FAKE_CONFIG,
      knowledgePaths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [owned], failures: [] }),
      statFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      rmFile: async () => {},
      rmSourceDir: async () => {},
      rmDir: async () => {},
      readToken: async () => {
        readTokenCalls += 1;
        return "wrong";
      },
      print: () => {},
      printErr: () => {},
    });
    expect(code).toBe(0);
    expect(readTokenCalls).toBe(0);
  });
});
