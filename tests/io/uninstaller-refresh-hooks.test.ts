import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { removeBundle } from "../../src/io/uninstaller";
import { readCodexHooks, registerAgentInCodexHooks } from "../../src/io/codex-hooks";
import { writeRefreshManifest } from "../../src/core/knowledge/refresh-manifest";
import type { InstallPaths } from "../../src/core/types";
import type { KnowledgePaths } from "../../src/io/knowledge-paths";
import { fakeBundle } from "../_helpers/fakeBundle";

// Verify Task 6: removeBundle deletes the per-agent refresh-manifest.json
// at <agentSmithHome>/agents/<name>/refresh-manifest.json after platform
// files and knowledge dir are removed.
//
// The uninstaller takes positional args (bundle, installPaths, knowledgePaths,
// deps) — the agent-smith home is already available via knowledgePaths.agentSmithHome,
// so no new option is needed. The manifest path layout matches the install side
// (see src/core/knowledge/refresh-manifest.ts).

describe("removeBundle: refresh-manifest cleanup", () => {
  let workDir: string;
  let agentSmithHome: string;
  let installPaths: InstallPaths;
  let knowledgePaths: KnowledgePaths;

  beforeEach(async () => {
    workDir = join(tmpdir(), `as-uninst-refresh-${Math.random().toString(36).slice(2)}`);
    agentSmithHome = join(workDir, "as-home");
    await mkdir(agentSmithHome, { recursive: true });
    installPaths = {
      opencode: join(workDir, "opencode/agents"),
      "claude-code": join(workDir, "claude/agents"),
      codex: join(workDir, "agents/skills"),
      kiro: join(workDir, "kiro/agents"),
    };
    knowledgePaths = { agentSmithHome };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("removes refresh-manifest.json when present", async () => {
    const bundle = fakeBundle("alpha", { targets: ["opencode"] });
    // Stage the installed agent file so removeBundle has something to remove.
    await mkdir(installPaths.opencode, { recursive: true });
    await writeFile(join(installPaths.opencode, "alpha.md"), "x");

    // Stage a refresh manifest as `smith agent knowledge install` would.
    await writeRefreshManifest(agentSmithHome, "alpha", {
      schemaVersion: 1,
      agent: "alpha",
      refresh_consent: {
        granted_at: "2026-05-18T00:00:00.000Z",
        platforms: ["claude-code"],
        sources: ["jira:PROJ"],
      },
    });

    const manifestPath = join(agentSmithHome, "agents", "alpha", "refresh-manifest.json");
    // Sanity: manifest exists before uninstall.
    expect(await stat(manifestPath).then(() => true).catch(() => false)).toBe(true);

    const result = await removeBundle(bundle, installPaths, knowledgePaths);

    expect(result.errors).toEqual([]);
    expect(await stat(manifestPath).then(() => true).catch(() => false)).toBe(false);
  });

  it("is a no-op when refresh-manifest.json is absent", async () => {
    const bundle = fakeBundle("beta", { targets: ["opencode"] });
    await mkdir(installPaths.opencode, { recursive: true });
    await writeFile(join(installPaths.opencode, "beta.md"), "x");

    const manifestPath = join(agentSmithHome, "agents", "beta", "refresh-manifest.json");
    expect(await stat(manifestPath).then(() => true).catch(() => false)).toBe(false);

    const result = await removeBundle(bundle, installPaths, knowledgePaths);

    expect(result.errors).toEqual([]);
    // Still absent — no error raised, no file created.
    expect(await stat(manifestPath).then(() => true).catch(() => false)).toBe(false);
  });
});

// Task 4: removeBundle reads the refresh-manifest (before deleting it) to
// discover which platforms have refresh hooks installed, and tears them down.
// For codex, this means calling removeAgentFromCodexHooks against the
// `<codexHome>/hooks.json` file. The shared hooks.json is deleted when the
// last consenting agent is removed (see removeAgentFromCodexHooks).
describe("removeBundle: codex refresh-hook cleanup", () => {
  let workDir: string;
  let agentSmithHome: string;
  let codexHome: string;
  let installPaths: InstallPaths;
  let knowledgePaths: KnowledgePaths;

  beforeEach(async () => {
    workDir = join(tmpdir(), `as-uninst-codex-hooks-${Math.random().toString(36).slice(2)}`);
    agentSmithHome = join(workDir, "as-home");
    codexHome = join(workDir, "codex-home");
    await mkdir(agentSmithHome, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    installPaths = {
      opencode: join(workDir, "opencode/agents"),
      "claude-code": join(workDir, "claude/agents"),
      codex: join(workDir, "agents/skills"),
      kiro: join(workDir, "kiro/agents"),
    };
    knowledgePaths = { agentSmithHome };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("removes the agent from <codexHome>/hooks.json on uninstall", async () => {
    const bundle = fakeBundle("agent-a", { targets: ["codex"] });

    // Stage two agents in hooks.json so we can assert the other survives.
    await registerAgentInCodexHooks(codexHome, "agent-a");
    await registerAgentInCodexHooks(codexHome, "agent-b");

    // Stage the codex skill file so the uninstaller has something to remove
    // through its normal flow (matches install layout: <codex>/<agent>/SKILL.md).
    await mkdir(join(installPaths.codex, "agent-a"), { recursive: true });
    await writeFile(join(installPaths.codex, "agent-a", "SKILL.md"), "x");

    // Manifest records that codex hooks were consented for agent-a.
    await writeRefreshManifest(agentSmithHome, "agent-a", {
      schemaVersion: 1,
      agent: "agent-a",
      refresh_consent: {
        granted_at: "2026-05-18T00:00:00.000Z",
        platforms: ["codex"],
        sources: ["jira:PROJ"],
      },
    });

    const result = await removeBundle(bundle, installPaths, knowledgePaths, {
      codexHome,
    });

    expect(result.errors).toEqual([]);
    const hooks = await readCodexHooks(codexHome);
    expect(hooks).toBeDefined();
    expect(hooks?._smith_managed.agents).toEqual(["agent-b"]);
  });

  it("deletes <codexHome>/hooks.json entirely when the last consenting agent is uninstalled", async () => {
    const bundle = fakeBundle("lone", { targets: ["codex"] });

    await registerAgentInCodexHooks(codexHome, "lone");

    await mkdir(join(installPaths.codex, "lone"), { recursive: true });
    await writeFile(join(installPaths.codex, "lone", "SKILL.md"), "x");

    await writeRefreshManifest(agentSmithHome, "lone", {
      schemaVersion: 1,
      agent: "lone",
      refresh_consent: {
        granted_at: "2026-05-18T00:00:00.000Z",
        platforms: ["codex"],
        sources: ["jira:PROJ"],
      },
    });

    const result = await removeBundle(bundle, installPaths, knowledgePaths, {
      codexHome,
    });

    expect(result.errors).toEqual([]);
    // File should have been removed by removeAgentFromCodexHooks once the
    // agent list emptied — readCodexHooks returns undefined for ENOENT.
    expect(await readCodexHooks(codexHome)).toBeUndefined();
  });
});
