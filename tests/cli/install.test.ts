import { describe, expect, test } from "bun:test";
import { install } from "../../src/cli/commands/install";
import { SmithError } from "../../src/core/smith-error";
import type { AgentBundle, InstallPaths } from "../../src/core/types";
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

describe("cli/install", () => {
  test("unknown agent name throws not-found, never calls buildAndInstall", async () => {
    let buildCalled = false;
    let caught: unknown;
    try {
      await install({
        name: "nonexistent",
        paths,
        loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
        loadAllBundles: async () => ({ bundles: [], failures: [] }),
        buildAndInstall: async () => {
          buildCalled = true;
          return emptyResult;
        },
        print: () => {},
        printErr: () => {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect(buildCalled).toBe(false);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("not-found");
    if (e.payload.code === "not-found") {
      expect(e.payload.identifier).toBe("nonexistent");
    }
  });

  test("happy path: installed entries print one line per target, exit 0", async () => {
    const printed: string[] = [];
    let receivedBundles: AgentBundle[] = [];
    const code = await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo"), fakeBundle("bar")], failures: [] }),
      buildAndInstall: async (bundles) => {
        receivedBundles = bundles;
        return {
          installed: [
            { target: "opencode", path: "/fake/opencode/agents/foo.md" },
            { target: "claude-code", path: "/fake/claude/agents/foo.md" },
          ],
          skipped: [],
          warnings: [],
          errors: [],
          grantedKnowledgeDirs: [],
          knowledge: [],
        };
      },
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    // Filter must narrow to just the requested bundle
    expect(receivedBundles).toHaveLength(1);
    expect(receivedBundles[0]?.config.name).toBe("foo");
    // One install summary line per installed target
    const installLines = printed.filter((m) => m.includes("/fake/"));
    expect(installLines).toHaveLength(2);
    expect(installLines[0]).toContain("opencode");
    expect(installLines[1]).toContain("claude-code");
  });

  test("orchestrator errors → exit 1, FAIL printed per agent with all messages", async () => {
    const printed: string[] = [];
    const code = await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async () => ({
        installed: [],
        skipped: [],
        warnings: [],
        errors: [{ agent: "foo", messages: ["schema mismatch", "model unresolved"] }],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(1);
    expect(printed.some((m) => m.includes("FAIL") && m.includes("foo"))).toBe(true);
    expect(printed.some((m) => m.includes("schema mismatch"))).toBe(true);
    expect(printed.some((m) => m.includes("model unresolved"))).toBe(true);
  });

  test("warnings print but do not change exit code", async () => {
    const printed: string[] = [];
    const code = await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async () => ({
        installed: [{ target: "opencode", path: "/fake/opencode/agents/foo.md" }],
        skipped: [],
        warnings: ["deprecated knowledge type 'reference'"],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });
    expect(code).toBe(0);
    expect(printed.some((m) => m.includes("deprecated"))).toBe(true);
  });

  test("forwards allowMissingMcp option into buildAndInstall (v1-task B7)", async () => {
    let receivedOptions: unknown;
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        receivedOptions = options;
        return emptyResult;
      },
      print: () => {},
      printErr: () => {},
      allowMissingMcp: true,
    });
    expect((receivedOptions as { allowMissingMcp?: boolean }).allowMissingMcp).toBe(true);
  });

  test("omits allowMissingMcp from buildAndInstall options when not set (v1-task B7)", async () => {
    let receivedOptions: unknown;
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        receivedOptions = options;
        return emptyResult;
      },
      print: () => {},
      printErr: () => {},
    });
    // When the flag isn't passed, the option key should not appear in the
    // forwarded options object — keeps default behavior path explicit.
    expect((receivedOptions as { allowMissingMcp?: boolean }).allowMissingMcp).toBeUndefined();
  });

  test("forwards allowMissingCli into buildAndInstall", async () => {
    let receivedOptions: unknown;
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        receivedOptions = options;
        return emptyResult;
      },
      print: () => {},
      printErr: () => {},
      allowMissingCli: true,
    });
    expect((receivedOptions as { allowMissingCli?: boolean }).allowMissingCli).toBe(true);
  });

  test("omits allowMissingCli when not set", async () => {
    let receivedOptions: unknown;
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async (_bundles, _paths, options) => {
        receivedOptions = options;
        return emptyResult;
      },
      print: () => {},
      printErr: () => {},
    });
    expect((receivedOptions as { allowMissingCli?: boolean }).allowMissingCli).toBeUndefined();
  });

  test("throws partial-failure when target bundle failed to load", async () => {
    let caught: unknown;
    try {
      await install({
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
    const code = await install({
      name: "good",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({
        bundles: [fakeBundle("good")],
        failures: [
          {
            sourceKind: "user-global" as const,
            sourceLabel: "test",
            bundlePath: "/cat/other",
            reason: "boom",
          },
        ],
      }),
      buildAndInstall: async () => emptyResult,
      print: (m) => printed.push(m),
      printErr: (m) => warnings.push(m),
    });
    expect(code).toBe(0);
    expect(warnings.some((w) => w.includes("/cat/other") && w.includes("boom"))).toBe(true);
  });

  test("prints knowledge lines + tally when result.knowledge populated", async () => {
    const printed: string[] = [];
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async () => ({
        installed: [{ target: "opencode", path: "/fake/opencode/agents/foo.md" }],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [
          {
            agent: "foo",
            sources: [
              { id: "guide", delivery: "file", files: 15, bytes: 312 * 1024, changed: true },
              { id: "cheat", delivery: "inline", files: 1, bytes: 8 * 1024, changed: false },
            ],
            totals: {
              files: 16,
              bytes: 320 * 1024,
              tokensInline: 980,
              tokensInlineBudget: 4000,
              hasInline: true,
            },
          },
        ],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });

    const joined = printed.join("\n");
    expect(joined).toContain("→ knowledge guide (15 files, 312.0KB, file)");
    expect(joined).toContain("· knowledge cheat (1 file, 8.0KB, inline) (unchanged)");
    expect(joined).toContain("1 changed, 1 unchanged");
    expect(joined).toContain("16 files, 320.0KB");
    expect(joined).toContain("inline tokens 980/4000");
  });

  test("does not print knowledge block when result.knowledge is empty", async () => {
    const printed: string[] = [];
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async () => ({
        installed: [{ target: "opencode", path: "/fake/opencode/agents/foo.md" }],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });

    expect(printed.join("\n")).not.toContain("knowledge");
  });

  test("does not print knowledge block when summary has zero sources", async () => {
    const printed: string[] = [];
    await install({
      name: "foo",
      paths,
      loadRegistry: async () => ({ schemaVersion: 2, sources: [] }) as Registry,
      loadAllBundles: async () => ({ bundles: [fakeBundle("foo")], failures: [] }),
      buildAndInstall: async () => ({
        installed: [{ target: "opencode", path: "/fake/opencode/agents/foo.md" }],
        skipped: [],
        warnings: [],
        errors: [],
        grantedKnowledgeDirs: [],
        knowledge: [
          {
            agent: "foo",
            sources: [],
            totals: { files: 0, bytes: 0, tokensInline: 0, tokensInlineBudget: 4000, hasInline: false },
          },
        ],
      }),
      print: (m) => printed.push(m),
      printErr: (m) => printed.push(m),
    });

    expect(printed.join("\n")).not.toContain("knowledge");
  });
});
