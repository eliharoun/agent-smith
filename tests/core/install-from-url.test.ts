// tests/core/install-from-url.test.ts
//
// C3.8 (v1-task): installFromUrl orchestrator — clones a remote, scans
// for bundles, and registers the catalog in the appropriate registry
// (agent or skill) with a populated `remote` block.
//
// Uses real bare git remotes via createBareRemote() so the end-to-end
// flow (clone -> scan -> register) is exercised without mocks.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromUrl } from "../../src/core/install-from-url";
import { createBareRemote } from "../fixtures/git-remote-helper";

let stateHomeDir: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  stateHomeDir = await mkdtemp(join(tmpdir(), "installFromUrl-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = stateHomeDir;
  // Post-RC2-1: defaultRemoteRoot() reads XDG_STATE_HOME. Without
  // isolating this, clones land in the user's real ~/.local/state.
  process.env.XDG_STATE_HOME = stateHomeDir;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(stateHomeDir, { recursive: true, force: true });
});

describe("installFromUrl [v1-task C3.8]", () => {
  test("agent kind: clones, scans, registers catalog with remote block", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "agents/fixture-agent/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "fixture-agent",
          description: "test fixture for installFromUrl",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      const result = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });

      expect(result.cloneDir).toContain("remote");
      expect(result.bundles).toEqual(["fixture-agent"]);
      expect(result.remote.url).toBe(remote.url);
      expect(result.remote.ref).toBe("main");
      expect(result.remote.lastPulledSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.remote.lastPulledAt).toBeTruthy();

      // Registry on disk should contain the new catalog with remote block.
      const reg = JSON.parse(
        await readFile(join(stateHomeDir, "agent-smith", "registry.json"), "utf-8"),
      );
      expect(reg.schemaVersion).toBe(2);
      const entry = reg.sources.find(
        (s: { remote?: { url: string } }) => s.remote?.url === remote.url,
      );
      expect(entry).toBeTruthy();
      expect(entry.kind).toBe("registered");
      expect(entry.rootPath).toBe(result.cloneDir);
      expect(entry.remote.lastPulledSha).toBe(result.remote.lastPulledSha);
    } finally {
      await remote.cleanup();
    }
  });

  test("skill kind: clones, scans, registers catalog with remote block", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "skills/fixture-skill/SKILL.md",
        "---\nname: fixture-skill\n---\n\n# Fixture skill\n",
      );

      const result = await installFromUrl({
        kind: "skill",
        url: remote.url,
        ref: "main",
      });

      expect(result.bundles).toContain("fixture-skill");
      expect(result.remote.url).toBe(remote.url);
      expect(result.remote.lastPulledSha).toMatch(/^[0-9a-f]{40}$/);

      const reg = JSON.parse(
        await readFile(join(stateHomeDir, "agent-smith", "skill-catalogs.json"), "utf-8"),
      );
      expect(reg.schemaVersion).toBe(2);
      const entry = reg.catalogs.find(
        (c: { remote?: { url: string } }) => c.remote?.url === remote.url,
      );
      expect(entry).toBeTruthy();
      expect(entry.rootPath).toBe(result.cloneDir);
    } finally {
      await remote.cleanup();
    }
  });

  test("idempotent: re-install of same URL reuses cloneDir and updates lastPulledSha", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "agents/x/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "x",
          description: "first",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      const first = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      const firstSha = first.remote.lastPulledSha;

      const newSha = await remote.commitFile("README.md", "second\n");
      expect(newSha).not.toBe(firstSha);

      const second = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      expect(second.cloneDir).toBe(first.cloneDir);
      expect(second.remote.lastPulledSha).toBe(newSha);

      // Registry should still contain exactly one entry for this URL.
      const reg = JSON.parse(
        await readFile(join(stateHomeDir, "agent-smith", "registry.json"), "utf-8"),
      );
      const matches = reg.sources.filter(
        (s: { remote?: { url: string } }) => s.remote?.url === remote.url,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].remote.lastPulledSha).toBe(newSha);
    } finally {
      await remote.cleanup();
    }
  });

  test("collision: different origin at same derived path throws actionable error", async () => {
    const remoteA = await createBareRemote();
    const remoteB = await createBareRemote();
    try {
      await remoteA.commitFile(
        "agents/a/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "a",
          description: "a",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );
      await remoteB.commitFile(
        "agents/b/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "b",
          description: "b",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      // Install A first to establish .git/config with remoteA url.
      const first = await installFromUrl({
        kind: "agent",
        url: remoteA.url,
        ref: "main",
      });

      // Force a path collision: install B with a remoteRoot+url combo
      // that derives to A's exact directory. We achieve this by rooting
      // installFromUrl at a remoteRoot whose `_local/<hash>-<leaf>`
      // for remoteB.url happens to equal first.cloneDir. The cleanest
      // way: copy A's already-cloned dir to a fresh path keyed by B's
      // url-derived hash, and reuse that as the target. Simpler: just
      // assert the orchestrator's checkCollision branch fires when
      // remoteB.url points at A's dir. We do so by routing B through
      // a remoteRoot that produces an existing collision dir.
      // The simplest forcing function is: re-derive A's path from B's
      // url by mutating remoteRoot so B's _local hash lands inside A's
      // already-populated cloneDir's parent with the same leaf. Since
      // hash differs per fs path, instead we point B at A's cloneDir
      // directly by routing B's _local derivation through a temp
      // remoteRoot whose `_local/<B-hash>-<B-leaf>` equals first.cloneDir
      // by symlink. Skip that contrivance — the production code path
      // hits the same checkCollision logic when the user re-installs
      // a *moved* repo whose origin no longer matches. Mimic that:
      // overwrite the .git/config of first.cloneDir to claim B's url
      // as origin, then re-install A → collision detected.
      const { writeFile, readFile } = await import("node:fs/promises");
      const gitCfg = join(first.cloneDir, ".git", "config");
      const cfg = await readFile(gitCfg, "utf-8");
      // Rewrite the origin url to remoteB.url so a re-install of A
      // looks like a different-origin collision.
      const patched = cfg.replace(/(\[remote "origin"\][\s\S]*?url\s*=\s*)\S+/, `$1${remoteB.url}`);
      await writeFile(gitCfg, patched, "utf-8");

      await expect(
        installFromUrl({ kind: "agent", url: remoteA.url, ref: "main" }),
      ).rejects.toThrow(/different origin/);
    } finally {
      await remoteA.cleanup();
      await remoteB.cleanup();
    }
  });
});

describe("installFromUrl ref validation (C4.0.2)", () => {
  // Each case attempts an install with a hostile ref. validation runs
  // synchronously at the top of installFromUrl, before any clone, so
  // we don't need a real remote — a placeholder https URL is enough
  // to reach the validator. The thrown error must mention ref + the
  // specific failure mode.
  const cases: Array<[string, string]> = [
    ["leading dash (option injection)", "--upload-pack=evil"],
    ["semicolon", "main;rm -rf /"],
    ["pipe", "main|cat /etc/passwd"],
    ["backtick", "main`whoami`"],
    ["dollar", "main$IFS"],
    ["newline", "main\nrm"],
    ["null byte", "main\u0000evil"],
  ];

  for (const [label, ref] of cases) {
    test(`rejects ref containing ${label}`, async () => {
      await expect(
        installFromUrl({
          kind: "agent",
          url: "https://example.test/owner/repo.git",
          ref,
        }),
      ).rejects.toThrow(/ref (starts with '-'|contains forbidden character)/);
    });
  }
});
