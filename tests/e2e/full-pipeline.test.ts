import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAllBundles } from "../../src/cli/load-all";
import type { InstallPaths } from "../../src/core/types";
import { buildAndInstall } from "../../src/io/orchestrator";
import type { Registry } from "../../src/io/registry";

// Inject `resolveSources` so loadAllBundles iterates only the explicit
// fixture source. Skips the synthetic `agent-smith-self` source contributed
// by the default `resolveAllSources`, keeping this e2e test scoped to the
// fixture dir.
const resolveExplicit = {
  resolveSources: (r: Registry) => Promise.resolve(r.sources),
};

let root: string;
let agentsDir: string;
let installPaths: InstallPaths;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smith-e2e-"));
  agentsDir = join(root, "agents");
  installPaths = {
    opencode: join(root, "out/opencode/agents"),
    "claude-code": join(root, "out/claude/agents"),
    codex: join(root, "out/agents/skills"),
    kiro: join(root, "out/kiro/agents")
  };
  // Make a complete bundle on disk
  const dir = join(agentsDir, "code-reviewer");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "agent.config.json"),
    JSON.stringify(
      {
        name: "code-reviewer",
        description: "Use proactively to review modified code",
        targets: ["opencode", "claude-code", "codex"],
        modelTier: "balanced",
        mode: "subagent",
      },
      null,
      2,
    ),
  );
  const identity = Array.from({ length: 18 }, (_, i) => `You are line ${i + 1}.`).join("\n");
  await writeFile(join(dir, "IDENTITY.md"), `${identity}\n`);
  const expertise = Array.from({ length: 60 }, (_, i) => `You analyze ${i + 1}.`).join("\n");
  await writeFile(join(dir, "EXPERTISE.md"), `${expertise}\n`);
  const soul = Array.from({ length: 18 }, (_, i) => `You speak ${i + 1}.`).join("\n");
  await writeFile(join(dir, "SOUL.md"), `${soul}\n`);
  const user = Array.from({ length: 25 }, (_, i) => `You note ${i + 1}.`).join("\n");
  await writeFile(join(dir, "USER.md"), `${user}\n`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("e2e/full-pipeline", () => {
  test("loads, validates, translates, and installs to all three targets", async () => {
    const { bundles } = await loadAllBundles(
      {
        schemaVersion: 2,
        sources: [{ kind: "user-global", rootPath: agentsDir, label: "test" }],
      },
      resolveExplicit,
    );
    expect(bundles).toHaveLength(1);

    const result = await buildAndInstall(bundles, installPaths, {
      modelResolutionEnv: {
        getOpenCodeModels: async () => undefined,
        warnings: { push() {} },
        detectAuthenticatedProviders: async () => ["anthropic"],
        // Inject fake auth detectors so the test doesn't depend on what's
        // installed on the test runner. Without these, claude/codex/kiro
        // resolvers probe PATH and may throw PlatformUnavailableError.
        detectClaudeCodeAuth: async () => ({
          platform: "claude-code",
          cliInstalled: true,
          status: "authenticated",
          availableModels: ["opus", "sonnet", "haiku"],
        }),
        detectCodexAuth: async () => ({
          platform: "codex",
          cliInstalled: true,
          status: "authenticated",
        }),
        detectKiroAuth: async () => ({
          platform: "kiro",
          cliInstalled: true,
          status: "authenticated",
        }),
        env: {},
      },
      homeDir: root,
    });
    expect(result.errors).toEqual([]);
    expect(result.installed).toHaveLength(3);

    const opencodeOut = await readFile(join(installPaths.opencode, "code-reviewer.md"), "utf8");
    expect(opencodeOut).toContain("description: Use proactively to review modified code");
    expect(opencodeOut).toContain("model: anthropic/claude-sonnet-4-6-20260101");
    expect(opencodeOut).toContain("mode: subagent");
    expect(opencodeOut).toContain("You are line 1.");
    expect(opencodeOut).toContain("You note 25.");

    const claudeOut = await readFile(join(installPaths["claude-code"], "code-reviewer.md"), "utf8");
    expect(claudeOut).toContain("name: code-reviewer");
    expect(claudeOut).toContain("model: sonnet");
    expect(claudeOut).not.toContain("mode:"); // mode is opencode-only

    const codexOut = await readFile(join(installPaths.codex, "code-reviewer", "SKILL.md"), "utf8");
    expect(codexOut).toContain("name: code-reviewer");
    expect(codexOut).toContain("description:");
    expect(codexOut).not.toContain("model:"); // codex frontmatter has only name/description

    // Recency-weighted assembly: USER content should appear after IDENTITY in the body
    const idIdx = opencodeOut.indexOf("You are line 1.");
    const userIdx = opencodeOut.indexOf("You note 1.");
    expect(idIdx).toBeGreaterThan(0);
    expect(userIdx).toBeGreaterThan(idIdx);
  });

  test("v0.6.0: resolved opencode model from live list lands in rendered .md", async () => {
    const { bundles } = await loadAllBundles(
      {
        schemaVersion: 2,
        sources: [{ kind: "user-global", rootPath: agentsDir, label: "test" }],
      },
      resolveExplicit,
    );
    const result = await buildAndInstall(bundles, installPaths, {
      modelResolutionEnv: {
        getOpenCodeModels: async () => [
          "github-copilot/claude-opus-4.7",
          "github-copilot/claude-sonnet-4.6",
          "github-copilot/claude-haiku-4.5",
        ],
        warnings: { push() {} },
        detectAuthenticatedProviders: async () => ["github-copilot"],
        env: {},
      },
      homeDir: root,
    });
    expect(result.errors).toEqual([]);
    const opencodeOut = await readFile(join(installPaths.opencode, "code-reviewer.md"), "utf8");
    // Tier "sonnet" should resolve from the live list, NOT from the fallback.
    expect(opencodeOut).toContain("model: github-copilot/claude-sonnet-4.6");
    expect(opencodeOut).not.toContain("fallback/sonnet");
  });

  test("v0.6.0: model override field bypasses tier resolution for opencode", async () => {
    // Write a NEW bundle with an explicit model override.
    const dir = join(agentsDir, "override-agent");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "agent.config.json"),
      JSON.stringify(
        {
          name: "override-agent",
          description: "Use proactively to test override",
          targets: ["opencode"],
          modelTier: "balanced",
          model: "anthropic/foo-1.0",
        },
        null,
        2,
      ),
    );
    const id = Array.from({ length: 18 }, (_, i) => `Identity ${i + 1}.`).join("\n");
    const exp = Array.from({ length: 60 }, (_, i) => `Expertise ${i + 1}.`).join("\n");
    const sl = Array.from({ length: 18 }, (_, i) => `Soul ${i + 1}.`).join("\n");
    const us = Array.from({ length: 25 }, (_, i) => `User ${i + 1}.`).join("\n");
    await writeFile(join(dir, "IDENTITY.md"), `${id}\n`);
    await writeFile(join(dir, "EXPERTISE.md"), `${exp}\n`);
    await writeFile(join(dir, "SOUL.md"), `${sl}\n`);
    await writeFile(join(dir, "USER.md"), `${us}\n`);

    const { bundles } = await loadAllBundles(
      {
        schemaVersion: 2,
        sources: [{ kind: "user-global", rootPath: agentsDir, label: "test" }],
      },
      resolveExplicit,
    );
    const result = await buildAndInstall(bundles, installPaths, {
      modelResolutionEnv: {
        getOpenCodeModels: async () => ["github-copilot/claude-sonnet-4.6"],
        warnings: { push() {} },
        detectAuthenticatedProviders: async () => ["github-copilot"],
      },
      homeDir: root,
    });
    expect(result.errors).toEqual([]);
    const overrideOut = await readFile(join(installPaths.opencode, "override-agent.md"), "utf8");
    expect(overrideOut).toContain("model: anthropic/foo-1.0");
    // Sanity: the live-list value should NOT have leaked into the override agent.
    expect(overrideOut).not.toContain("github-copilot/claude-sonnet-4.6");
  });
});
