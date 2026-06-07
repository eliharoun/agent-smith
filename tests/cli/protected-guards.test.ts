import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setCloneModeForTesting } from "../../src/core/protected-bundles";
import { runUninstallCli } from "../../src/cli/commands/uninstall";
import { runDestroyAgentCli } from "../../src/cli/commands/destroy-agent";
import { reconfigureAgent } from "../../src/cli/commands/agent/reconfigure";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";
import { knowledgeRemove } from "../../src/cli/commands/knowledge/remove";
import { unregister } from "../../src/cli/commands/unregister";
import { skillUnregister } from "../../src/cli/commands/skill/unregister";
import { guardProtectedAgent, guardProtectedSkill } from "../../src/cli/commands/protected-confirm";
import type { InstallPaths } from "../../src/core/types";
import type { Registry } from "../../src/io/registry";

// Fully-fake paths so a guard that *passes* (clone mode + 'y') can never touch
// the real home dir. Every removal hook is a no-op; registry/bundle loaders
// return empty so the command resolves to a clean not-found AFTER the guard.
const FAKE_PATHS: InstallPaths = {
  opencode: "/fake/opencode/agents",
  "claude-code": "/fake/claude/agents",
  codex: "/fake/agents/skills",
  kiro: "/fake/kiro/agents",
  "agents-md": "/fake/agents-md/agents",
};
const SANDBOX = {
  paths: FAKE_PATHS,
  configDir: "/fake/config/agent-smith",
  homeDir: "/fake/home",
  loadRegistry: async (): Promise<Registry> => ({ schemaVersion: 2, sources: [] }) as Registry,
  loadAllBundles: async () => ({ bundles: [], failures: [] }),
  rmFile: async () => {},
  rmDir: async () => {},
  rmSourceDir: async () => {},
  statFile: async () => ({}),
  detectInstalledPlatforms: async () => new Set<never>(),
  print: () => {},
  printErr: () => {},
};

async function thrownFrom(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to throw, but it resolved");
}

describe("protected-agent CLI guards (non-clone machine → hard refusal)", () => {
  beforeEach(() => _setCloneModeForTesting(false));
  afterEach(() => _setCloneModeForTesting(null));

  test("uninstall agent-smith refuses with system-agent + smith update", async () => {
    const err = await thrownFrom(() => runUninstallCli({ ...SANDBOX, name: "agent-smith" }));
    expect(err.message).toContain("system agent");
    expect(err.message).toContain("smith update");
  });

  test("destroy agent-smith refuses", async () => {
    const err = await thrownFrom(() => runDestroyAgentCli({ ...SANDBOX, name: "agent-smith" }));
    expect(err.message).toContain("system agent");
  });

  test("reconfigure agent-smith refuses", async () => {
    const err = await thrownFrom(() =>
      reconfigureAgent("agent-smith", { grant: [], revoke: [] }, {}),
    );
    expect(err.message).toContain("system agent");
  });
});

describe("protected-agent CLI guards (clone machine → confirmation prompt)", () => {
  beforeEach(() => _setCloneModeForTesting(true));
  afterEach(() => _setCloneModeForTesting(null));

  test("uninstall aborts on 'n'", async () => {
    const err = await thrownFrom(() =>
      runUninstallCli({ ...SANDBOX, name: "agent-smith", confirmFn: async () => "n" }),
    );
    expect(err.message).toContain("cancelled by user");
  });

  test("uninstall 'y' passes the guard (fails later on not-found, not on protection)", async () => {
    // Sandboxed: empty registry/bundles + no-op rm hooks, so passing the guard
    // mutates nothing real and resolves to a clean not-found.
    const err = await thrownFrom(() =>
      runUninstallCli({ ...SANDBOX, name: "agent-smith", confirmFn: async () => "y" }),
    );
    expect(err.message).not.toContain("system agent");
    expect(err.message).not.toContain("cancelled by user");
  });

  test("destroy aborts on 'n' via readToken seam", async () => {
    const err = await thrownFrom(() =>
      runDestroyAgentCli({ ...SANDBOX, name: "agent-smith", readToken: async () => "n" }),
    );
    expect(err.message).toContain("cancelled by user");
  });

  test("reconfigure aborts on 'n' via deps.prompt seam", async () => {
    const err = await thrownFrom(() =>
      reconfigureAgent("agent-smith", { grant: [], revoke: [] }, { prompt: async () => "n" }),
    );
    expect(err.message).toContain("cancelled by user");
  });
});

describe("protected-agent knowledge guards (keyed on bundleDir basename)", () => {
  let tmp: string;
  beforeEach(async () => {
    _setCloneModeForTesting(false);
    tmp = await mkdtemp(join(tmpdir(), "knowledge-guard-"));
  });
  afterEach(async () => {
    _setCloneModeForTesting(null);
    await rm(tmp, { recursive: true, force: true });
  });

  test("knowledge add to agent-smith bundle refuses", async () => {
    const bundleDir = join(tmp, "agent-smith");
    await mkdir(bundleDir);
    await writeFile(join(bundleDir, "agent.config.json"), JSON.stringify({ name: "agent-smith" }));
    const err = await thrownFrom(() =>
      knowledgeAdd({ bundleDir, type: "git", pathOrUrl: "https://example.com/x.git" }),
    );
    expect(err.message).toContain("system agent");
  });

  test("knowledge remove from agent-smith bundle refuses", async () => {
    const bundleDir = join(tmp, "agent-smith");
    await mkdir(bundleDir);
    await writeFile(join(bundleDir, "agent.config.json"), JSON.stringify({ name: "agent-smith" }));
    const err = await thrownFrom(() => knowledgeRemove({ bundleDir, sourceId: "any" }));
    expect(err.message).toContain("system agent");
  });

  test("knowledge add to a user bundle is NOT blocked by the guard", async () => {
    const bundleDir = join(tmp, "my-agent");
    await mkdir(bundleDir);
    // No config file: knowledgeAdd should fail with config-missing, proving the
    // protection guard did NOT trip (it would have thrown system-agent first).
    const err = await thrownFrom(() =>
      knowledgeAdd({ bundleDir, type: "git", pathOrUrl: "https://example.com/x.git" }),
    );
    expect(err.message).not.toContain("system agent");
  });
});

describe("protected-catalog unregister guards", () => {
  beforeEach(() => _setCloneModeForTesting(false));
  afterEach(() => _setCloneModeForTesting(null));

  test("agent unregister agent-smith-self refuses (not incidental not-found)", async () => {
    const err = await thrownFrom(() => unregister("agent-smith-self"));
    expect(err.message).toContain("agent-smith-self");
    expect(err.message).not.toContain("not found");
  });

  test("skill unregister agent-smith-self refuses", async () => {
    const err = await thrownFrom(() => skillUnregister("agent-smith-self"));
    expect(err.message).toContain("agent-smith-self");
    expect(err.message).not.toContain("not found");
  });
});

describe("guardProtectedSkill (drives `smith skill uninstall <bundled-skill>`)", () => {
  beforeEach(() => _setCloneModeForTesting(false));
  afterEach(() => _setCloneModeForTesting(null));

  test("refuses the-architect on a user machine", async () => {
    const err = await thrownFrom(() => guardProtectedSkill("the-architect", "uninstall"));
    expect(err.message).toContain("the-architect");
    expect(err.message).toContain("system skill");
  });

  test("refuses the-keymaker on a user machine", async () => {
    const err = await thrownFrom(() => guardProtectedSkill("the-keymaker", "uninstall"));
    expect(err.message).toContain("the-keymaker");
  });

  test("is a no-op for a user-owned skill", async () => {
    await guardProtectedSkill("my-skill", "uninstall"); // must not throw
  });

  test("clone mode + 'n' aborts", async () => {
    _setCloneModeForTesting(true);
    const err = await thrownFrom(() =>
      guardProtectedSkill("the-architect", "uninstall", async () => "n"),
    );
    expect(err.message).toContain("cancelled by user");
  });
});

describe("guardProtectedAgent is a no-op for user agents", () => {
  beforeEach(() => _setCloneModeForTesting(false));
  afterEach(() => _setCloneModeForTesting(null));

  test("does not throw for a non-protected name", async () => {
    await guardProtectedAgent("my-agent", "uninstall"); // must not throw
  });
});
