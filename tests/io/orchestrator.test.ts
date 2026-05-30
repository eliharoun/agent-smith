import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelResolutionEnv } from "../../src/core/model-resolution";
import {
  buildAndInstall,
  deriveSkillSourceRoots,
  sortByPrecedence,
} from "../../src/io/orchestrator";
import { fakeBundle } from "../_helpers/fakeBundle";

const fakeModelEnv: ModelResolutionEnv = {
  getOpenCodeModels: async () => undefined,
  warnings: { push() {} },
  detectAuthenticatedProviders: async () => ["github-copilot"],
  // Hermeticity: claude-code/codex/kiro resolvers throw PlatformUnavailableError
  // when their CLI is absent (true on CI runners). Inject authenticated auth so
  // resolution is deterministic regardless of which platform CLIs the host has
  // installed — otherwise buildAndInstall reports "no targets resolvable" and
  // these tests pass only on machines that happen to have `claude` installed.
  detectClaudeCodeAuth: async () => ({
    platform: "claude-code",
    cliInstalled: true,
    status: "authenticated",
  }),
  detectCodexAuth: async () => ({ platform: "codex", cliInstalled: true, status: "authenticated" }),
  detectKiroAuth: async () => ({ platform: "kiro", cliInstalled: true, status: "authenticated" }),
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smith-orch-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("io/orchestrator", () => {
  test("sortByPrecedence orders project > user-global > registered", () => {
    const bundles = [
      fakeBundle("a", { kind: "registered" }),
      fakeBundle("a", { kind: "user-global" }),
      fakeBundle("a", { kind: "project" }),
    ];
    const sorted = sortByPrecedence(bundles);
    expect(sorted.map((b) => b.source.kind)).toEqual(["project", "user-global", "registered"]);
  });

  test("deriveSkillSourceRoots returns sibling skills/ dir for each unique bundle source root", () => {
    const bundles = [
      { source: { rootPath: "/foo/agents", kind: "user-global" } },
      { source: { rootPath: "/foo/agents", kind: "user-global" } },
      { source: { rootPath: "/bar/baz/agents", kind: "project" } },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for pure helper
    ] as any;
    expect(deriveSkillSourceRoots(bundles).sort()).toEqual(["/bar/baz/skills", "/foo/skills"]);
  });

  test("buildAndInstall validates, translates, and installs", async () => {
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const result = await buildAndInstall([fakeBundle("demo", { kind: "user-global" })], paths, {
      modelResolutionEnv: fakeModelEnv,
      homeDir: root,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]?.target).toBe("opencode");
  });

  test("buildAndInstall prefixes translator warnings with [name/target]", async () => {
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const bundle = fakeBundle("demo", { kind: "user-global" });
    bundle.config.targets = ["claude-code", "codex"];
    bundle.config.permission = { bash: "deny" };
    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv: fakeModelEnv,
      homeDir: root,
    });
    expect(result.errors).toHaveLength(0);
    // The "deny → omitted" warnings on claude-code and codex were dropped
    // as platform truisms. We assert their absence so future regressions
    // (re-introducing the spam) fail loudly.
    expect(result.warnings).not.toContain(
      "[demo/claude-code] claude-code has no deny semantic; denied tools are simply omitted from allowed-tools.",
    );
    expect(result.warnings).not.toContain(
      "[demo/codex] codex has no deny semantic; denied tools are simply omitted from allowed_tools.",
    );
  });

  test("buildAndInstall prefixes resolver warnings with [name/target] (regression for 62c01d5)", async () => {
    // Regression guard for commit 62c01d5: when the orchestrator builds its
    // own ModelResolutionEnv (no injection), resolver warnings are prefixed
    // `[<agent-name>/<target>]`. We verify the prefix by injecting an env
    // whose warnings collector feeds into the orchestrator's warnings array
    // via the same push() pattern the production env uses.
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const bundle = fakeBundle("demo", { kind: "user-global" });
    bundle.config.targets = ["opencode"];

    // Simulate the production env's prefix-applying collector pattern:
    const prefixedWarnings: string[] = [];
    const result = await buildAndInstall([bundle], paths, {
      modelResolutionEnv: {
        getOpenCodeModels: async () => undefined,
        warnings: {
          push(w) {
            prefixedWarnings.push(`[${bundle.config.name}/${w.target}] ${w.message}`);
          },
        },
        detectAuthenticatedProviders: async () => ["github-copilot"],
      },
      homeDir: root,
    });
    expect(result.errors).toHaveLength(0);
    // The resolver emits a "CLI unavailable" warning via Step 8 curated path.
    const resolverWarning = prefixedWarnings.find((w) => w.includes("unavailable"));
    expect(resolverWarning).toBeDefined();
    expect(resolverWarning).toMatch(/^\[demo\/opencode\]/);
  });

  test("buildAndInstall surfaces validator errors and installs nothing", async () => {
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const broken = fakeBundle("demo", { kind: "user-global" });
    broken.files.identity = ""; // empty -> validator error
    const result = await buildAndInstall([broken], paths, {
      modelResolutionEnv: fakeModelEnv,
      homeDir: root,
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.installed).toHaveLength(0);
  });

  test("buildAndInstall surfaces skill warnings and injects Default Skills section", async () => {
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const emptySkillsRoot = join(root, "empty-skills");
    await mkdir(emptySkillsRoot, { recursive: true });
    const skillPaths = {
      sourceRoots: [emptySkillsRoot],
      opencodeSkillsDir: join(emptySkillsRoot, "opencode"),
      claudeSkillsDir: join(emptySkillsRoot, "claude"),
      codexSkillsDir: join(emptySkillsRoot, "codex"),
    };
    const bundle = fakeBundle("demo", { kind: "user-global" });
    bundle.config.skills = ["test-driven-development"];
    const result = await buildAndInstall([bundle], paths, {
      skillPaths,
      modelResolutionEnv: fakeModelEnv,
      homeDir: root,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toContain(
      "[demo] skill 'test-driven-development' not found in any agent-smith source or platform skill dir",
    );
    const installedFile = join(paths.opencode, "demo.md");
    const contents = await readFile(installedFile, "utf8");
    expect(contents).toContain("## Default Skills");
    expect(contents).toContain("- `test-driven-development`");
  });

  test("buildAndInstall warns when an MCP server is referenced but not configured", async () => {
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const opencodeConfigPath = join(root, "opencode.json");
    await writeFile(opencodeConfigPath, JSON.stringify({ mcp: { linear: {} } }));
    const mcpPaths = {
      opencodeConfig: opencodeConfigPath,
      claudeMcpConfig: join(root, "no-claude-mcp.json"),
      codexConfig: join(root, "no-codex-config.toml"),
    };
    const bundle = fakeBundle("demo", { kind: "user-global" });
    bundle.config.mcpServers = ["github"];
    // With allowMissingMcp:true, an unconfigured server still surfaces but
    // as a warning — install proceeds. This is the explicit opt-out path
    // for users who have a good reason (optional MCP, etc).
    const result = await buildAndInstall([bundle], paths, {
      mcpPaths,
      modelResolutionEnv: fakeModelEnv,
      allowMissingMcp: true,
      homeDir: root,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toContain(
      "[demo] MCP server 'github' referenced but not configured for opencode",
    );
  });

  test("buildAndInstall errors when an MCP server is referenced but not configured (v1-task B7)", async () => {
    // Default behavior (allowMissingMcp not set): unconfigured MCP server
    // is a hard error that aborts the bundle's install. The user gets a
    // clear hint on how to configure the missing server OR explicitly
    // opt out with --allow-missing-mcp.
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const opencodeConfigPath = join(root, "opencode.json");
    await writeFile(opencodeConfigPath, JSON.stringify({ mcp: { linear: {} } }));
    const mcpPaths = {
      opencodeConfig: opencodeConfigPath,
      claudeMcpConfig: join(root, "no-claude-mcp.json"),
      codexConfig: join(root, "no-codex-config.toml"),
    };
    const bundle = fakeBundle("demo", { kind: "user-global" });
    bundle.config.mcpServers = ["github"];
    const result = await buildAndInstall([bundle], paths, {
      mcpPaths,
      modelResolutionEnv: fakeModelEnv,
      homeDir: root,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.agent).toBe("demo");
    expect(result.errors[0]?.messages.some((m) => m.includes("github"))).toBe(true);
    expect(result.errors[0]?.messages.some((m) => m.includes("--allow-missing-mcp"))).toBe(true);
    // No agent file should have been written — install aborted at validation.
    expect(result.installed).toHaveLength(0);
  });

  test("reports lock-held as a per-agent error and continues with other agents", async () => {
    const { acquireInstallLock, releaseRefreshLock } = await import(
      "../../src/core/knowledge/refresh-lock"
    );
    const paths = {
      opencode: join(root, "opencode/agents"),
      "claude-code": join(root, "claude/agents"),
      codex: join(root, "agents/skills"),
      kiro: join(root, "kiro/agents"),
    };
    const bundleA = fakeBundle("locked-agent", { kind: "user-global" });
    const bundleB = fakeBundle("free-agent", { kind: "user-global" });

    // Pre-acquire the install lock for bundleA's agent
    const agentSmithHome = join(root, "agent-smith-home");
    const lock = await acquireInstallLock(agentSmithHome, "locked-agent");
    expect(lock).toBeDefined();

    try {
      const result = await buildAndInstall([bundleA, bundleB], paths, {
        modelResolutionEnv: fakeModelEnv,
        knowledgePaths: {
          agentSmithHome,
        },
        homeDir: root,
      });
      // The locked agent should appear in errors
      const lockedError = result.errors.find((e) => e.agent === "locked-agent");
      expect(lockedError).toBeDefined();
      expect(
        lockedError!.messages.some((m) => m.includes("another install/refresh is in progress")),
      ).toBe(true);
      expect(lockedError!.messages.some((m) => m.includes("locked-agent"))).toBe(true);
      // Existing orchestrator semantics: any per-bundle error aborts the
      // entire batch (all-or-nothing install). The free-agent's render was
      // collected but installRendered was never called.
      expect(result.installed).toHaveLength(0);
    } finally {
      await releaseRefreshLock(lock!);
    }
  });
});
