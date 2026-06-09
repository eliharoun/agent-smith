// tests/cli/agent-install-from-url.test.ts
//
// C3.9 (v1-task): wire `smith agent install --from <url>` end-to-end.
// The orchestrator (installFromUrl, C3.8) does the clone + register; the
// CLI verb auto-installs the bundle when exactly one is found, and emits
// an actionable error pointing the user at the disambiguated form when
// more than one bundle lives in the repo.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import { createBareRemote } from "../fixtures/git-remote-helper";

// Per-test timeout (ms). Bun's default is 5000ms, which is too tight for
// the heavy git work these tests do: each `seedBundle()` issues 5 commits
// (= 5 × {add, commit, push, rev-parse} ≈ 20 git child-process spawns)
// and most cases seed two bundles plus run the install/clone path on
// top. Under parallel test-worker load on macOS, that easily blows past
// 5s — verified empirically by stress-running this file with 5 parallel
// `bun test` invocations: 5/5 hit 5000ms timeouts on different cases.
// 30s gives ~6× headroom at the 95th percentile observed wall time.
const HEAVY_GIT_TIMEOUT_MS = 30_000;

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;
let prevClaudeTier: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-install-from-url-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
  // Hermeticity: the bundles target claude-code (modelTier "balanced"), whose
  // resolver throws PlatformUnavailableError when the `claude` CLI is absent
  // (true on CI). Pin the tier via env so resolution succeeds without the CLI —
  // otherwise buildAndInstall reports "no targets resolvable" and these tests
  // pass only on hosts that happen to have `claude` installed.
  prevClaudeTier = process.env.SMITH_CLAUDE_TIER_BALANCED;
  process.env.SMITH_CLAUDE_TIER_BALANCED = "sonnet";
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  if (prevClaudeTier === undefined) delete process.env.SMITH_CLAUDE_TIER_BALANCED;
  else process.env.SMITH_CLAUDE_TIER_BALANCED = prevClaudeTier;
  await rm(home, { recursive: true, force: true });
});

const VALID_CONFIG = (name: string) =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    description: "Use proactively to test the --from URL install flow.",
    targets: ["claude-code"],
    modelTier: "balanced",
  });

async function seedBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
  dir = name,
): Promise<void> {
  await remote.commitFile(`${dir}/agent.config.json`, VALID_CONFIG(name));
  await remote.commitFile(`${dir}/IDENTITY.md`, `# ${name}\n\nYou exist.\n`);
  await remote.commitFile(`${dir}/EXPERTISE.md`, `# Expertise\n\nYou do.\n`);
  await remote.commitFile(`${dir}/SOUL.md`, `# Soul\n\nYou speak.\n`);
  await remote.commitFile(`${dir}/USER.md`, `# User\n\nYou note.\n`);
}

describe("smith agent install --from <url> [v1-task C3.9]", () => {
  test("clones remote, registers catalog, installs the only bundle in the repo", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");

      const logs: string[] = [];
      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: (m) => logs.push(m),
        printErr: (m) => errs.push(m),
      });

      expect(code).toBe(0);
      // The auto-resolved bundle name should appear in the install output.
      const joined = [...logs, ...errs].join("\n");
      expect(joined).toContain("fixture-agent");
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("errors with disambiguation hint when --from URL has >1 bundle and no name", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: () => {},
        printErr: (m) => errs.push(m),
      });

      expect(code).not.toBe(0);
      const joined = errs.join("\n");
      expect(joined).toContain("alpha-agent");
      expect(joined).toContain("beta-agent");
      expect(joined).toMatch(/install <?name>?|specify which/i);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("installs the named bundle when --from URL has multiple and name is given", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const code = await install({
        name: "beta-agent",
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: () => {},
        printErr: () => {},
      });

      expect(code).toBe(0);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("--all installs every agent from a multi-agent remote (to declared targets)", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const code = await install({
        from: remote.url,
        ref: "main",
        all: true,
        platformFilter: ["claude-code"],
        noRefreshHooks: true,
        print: () => {},
        printErr: () => {},
      });

      expect(code).toBe(0);
      const reg = JSON.parse(
        await Bun.file(join(home, "agent-smith", "registry.json")).text(),
      );
      expect(reg.sources.some((s: { gitRemote?: string }) => s.gitRemote === remote.url)).toBe(true);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("--json prints agent discovery with declared targets and does not install", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const out: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        json: true,
        noRefreshHooks: true,
        print: (m) => out.push(m),
        printErr: () => {},
      });

      expect(code).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.kind).toBe("agent");
      expect(parsed.bundles.find((b: { name: string }) => b.name === "alpha-agent")?.targets).toEqual(["claude-code"]);
      expect(await Bun.file(join(home, "agent-smith", "registry.json")).exists()).toBe(false);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("TTY picker selects a subset of agents", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const code = await install({
        from: remote.url,
        ref: "main",
        platformFilter: ["claude-code"],
        noRefreshHooks: true,
        isTTY: () => true,
        prompt: async () => "1",
        print: () => {},
        printErr: () => {},
      });

      expect(code).toBe(0);
      // Only alpha-agent (item #1 in sorted list) should be installed
      const reg = JSON.parse(
        await Bun.file(join(home, "agent-smith", "registry.json")).text(),
      );
      expect(reg.sources.some((s: { gitRemote?: string }) => s.gitRemote === remote.url)).toBe(true);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("all-skipped returns exit 1 with message", async () => {
    const remote = await createBareRemote();
    try {
      // Both agents target opencode only
      const cfg = (name: string) => JSON.stringify({
        schemaVersion: 1, name, description: "Use proactively to test the all-skipped flow.", targets: ["opencode"], modelTier: "balanced",
      });
      await remote.commitFile("a/agent.config.json", cfg("alpha-agent"));
      await remote.commitFile("a/IDENTITY.md", "# a\n\nYou exist.\n");
      await remote.commitFile("a/EXPERTISE.md", "# e\n\nYou do.\n");
      await remote.commitFile("a/SOUL.md", "# s\n\nYou speak.\n");
      await remote.commitFile("b/agent.config.json", cfg("beta-agent"));
      await remote.commitFile("b/IDENTITY.md", "# b\n\nYou exist.\n");
      await remote.commitFile("b/EXPERTISE.md", "# e\n\nYou do.\n");
      await remote.commitFile("b/SOUL.md", "# s\n\nYou speak.\n");

      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        all: true,
        platformFilter: ["claude-code"],
        noRefreshHooks: true,
        print: () => {},
        printErr: (m) => errs.push(m),
      });

      expect(code).toBe(1);
      expect(errs.join("\n")).toMatch(/no agents were installed/i);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("discoverFromUrl enumerates a bundle nested under agents/<name>/ and keeps rootPath at the clone root", async () => {
    const { discoverFromUrl } = await import("../../src/core/install-from-url");
    const remote = await createBareRemote();
    const remoteRoot = await mkdtemp(join(tmpdir(), "nested-url-remote-root-"));
    try {
      const dir = "agents/my-agent";
      await remote.commitFile(
        `${dir}/agent.config.json`,
        JSON.stringify({
          schemaVersion: 1,
          name: "my-agent",
          description: "Use proactively as a nested-URL install fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
        }),
      );
      await remote.commitFile(`${dir}/IDENTITY.md`, "placeholder\n");
      await remote.commitFile(`${dir}/EXPERTISE.md`, "placeholder\n");
      await remote.commitFile(`${dir}/SOUL.md`, "placeholder\n");
      await remote.commitFile(`${dir}/USER.md`, "placeholder\n");

      const discovered = await discoverFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
        remoteRoot,
        homeDir: home,
      });

      const names = discovered.bundles.map((b) => b.name).sort();
      expect(names).toContain("my-agent");
      // rootPath must be the clone root, NOT the agents/ subdir.
      expect(discovered.catalog.rootPath.endsWith("/agents")).toBe(false);
    } finally {
      await rm(remoteRoot, { recursive: true, force: true });
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("agent skipped with a warning when no selected platform matches its declared targets", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      // beta-agent targets opencode only
      await remote.commitFile("b/agent.config.json", JSON.stringify({
        schemaVersion: 1,
        name: "beta-agent",
        description: "Use proactively to test the --from URL install flow.",
        targets: ["opencode"],
        modelTier: "balanced",
      }));
      await remote.commitFile("b/IDENTITY.md", "# beta-agent\n\nYou exist.\n");
      await remote.commitFile("b/EXPERTISE.md", "# Expertise\n\nYou do.\n");
      await remote.commitFile("b/SOUL.md", "# Soul\n\nYou speak.\n");
      await remote.commitFile("b/USER.md", "# User\n\nYou note.\n");

      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        all: true,
        platformFilter: ["claude-code"],
        noRefreshHooks: true,
        print: () => {},
        printErr: (m) => errs.push(m),
      });

      expect(errs.join("\n")).toMatch(/skipping beta-agent/i);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);
});
