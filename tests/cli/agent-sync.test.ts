// tests/cli/agent-sync.test.ts
//
// C3.11 (v1-task): `smith agent sync` — pull updates for remote-backed
// agent catalogs.
//
// Three modes covered:
//   sync <name>     → resolve catalog by label/path, fetch+reset, update
//                     lastPulledSha + lastRemoteSha + timestamps
//   sync --check    → git ls-remote only; updates lastRemoteSha +
//                     lastCheckedAt but leaves working tree + lastPulledSha
//                     untouched
//   sync --all      → iterate every remote-backed catalog; partial
//                     failures don't abort the run, exit code reflects
//                     max severity observed
//
// All tests honor XDG_CONFIG_HOME so they share state with
// installFromUrl and canonicalRegistryPath transparently.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentSync } from "../../src/cli/commands/agent/sync";
import { installFromUrl } from "../../src/core/install-from-url";
import { canonicalRegistryPath, loadRegistry } from "../../src/io/registry";
import { createBareRemote } from "../fixtures/git-remote-helper";

const VALID_CONFIG = (name: string) =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    description: "Use proactively to test the sync flow.",
    targets: ["claude-code"],
    modelTier: "balanced",
  });

async function seedBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
  dir = name,
): Promise<string> {
  await remote.commitFile(`${dir}/agent.config.json`, VALID_CONFIG(name));
  await remote.commitFile(`${dir}/IDENTITY.md`, `# ${name}\n\nYou exist.\n`);
  await remote.commitFile(`${dir}/EXPERTISE.md`, `# Expertise\n\nYou do.\n`);
  await remote.commitFile(`${dir}/SOUL.md`, `# Soul\n\nYou speak.\n`);
  return await remote.commitFile(`${dir}/USER.md`, `# User\n\nYou note.\n`);
}

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-sync-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
});

describe("smith agent sync [v1-task C3.11]", () => {
  test("sync <label> pulls new commits and updates lastPulledSha", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");
      const initial = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      const before = initial.remote.lastPulledSha;

      // New commit on the remote — should not be reflected yet.
      const newSha = await remote.commitFile("README.md", "more\n");
      expect(newSha).not.toBe(before);

      const reg0 = await loadRegistry(canonicalRegistryPath());
      const source = reg0.sources.find((s) => s.rootPath === initial.cloneDir);
      const label = source?.label;
      expect(label).toBeTruthy();

      const code = await runAgentSync({ name: label! });
      expect(code).toBe(0);

      const reg1 = await loadRegistry(canonicalRegistryPath());
      const updated = reg1.sources.find((s) => s.rootPath === initial.cloneDir);
      expect(updated?.remote?.lastPulledSha).toBe(newSha);
      expect(updated?.remote?.lastRemoteSha).toBe(newSha);
      // Timestamps must advance (or equal — same-millisecond is possible
      // but unlikely on a CI machine; lower bound: not earlier).
      expect(new Date(updated!.remote!.lastPulledAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(initial.remote.lastPulledAt!).getTime(),
      );
    } finally {
      await remote.cleanup();
    }
  });

  test("sync --check updates lastRemoteSha but does NOT mutate working tree or lastPulledSha", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");
      const initial = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      const beforePulled = initial.remote.lastPulledSha;
      const newSha = await remote.commitFile("README.md", "more\n");
      expect(newSha).not.toBe(beforePulled);

      const reg0 = await loadRegistry(canonicalRegistryPath());
      const label = reg0.sources.find((s) => s.rootPath === initial.cloneDir)?.label;

      const code = await runAgentSync({ name: label!, check: true });
      expect(code).toBe(0);

      const reg1 = await loadRegistry(canonicalRegistryPath());
      const updated = reg1.sources.find((s) => s.rootPath === initial.cloneDir);
      // lastPulledSha unchanged (no fetch+reset performed).
      expect(updated?.remote?.lastPulledSha).toBe(beforePulled);
      // lastRemoteSha advanced to the new tip.
      expect(updated?.remote?.lastRemoteSha).toBe(newSha);
      // lastCheckedAt must be set.
      expect(updated?.remote?.lastCheckedAt).toBeTruthy();
    } finally {
      await remote.cleanup();
    }
  });

  test("sync --all syncs every remote-backed catalog; partial failures don't abort", async () => {
    const remoteOk = await createBareRemote();
    const remoteBad = await createBareRemote();
    try {
      await seedBundle(remoteOk, "ok-agent");
      await seedBundle(remoteBad, "bad-agent");
      const okInitial = await installFromUrl({
        kind: "agent",
        url: remoteOk.url,
        ref: "main",
      });
      await installFromUrl({
        kind: "agent",
        url: remoteBad.url,
        ref: "main",
      });

      // Break the second remote so fetch fails.
      await remoteBad.cleanup();

      // Add a new commit to the good remote.
      const newSha = await remoteOk.commitFile("README.md", "more\n");

      const code = await runAgentSync({ all: true });
      // Partial-failure exit code (3) — one succeeded, one failed.
      expect(code).toBe(3);

      const reg = await loadRegistry(canonicalRegistryPath());
      const okSource = reg.sources.find((s) => s.rootPath === okInitial.cloneDir);
      expect(okSource?.remote?.lastPulledSha).toBe(newSha);
    } finally {
      await remoteOk.cleanup();
    }
  }, // routinely take 5-8s on macOS. Bumped from bun's 5s default to 30s after the // Integration test: real git operations (bare-remote create, clone, fetch, commit)
  // post-2026-05-27 model-resolution rewrite added auth.json read + live-models
  // probing per install, which pushed combined wall-time past 5s.
  30_000);

  test("sync <name> errors when no remote-backed catalog matches", async () => {
    let stderr = "";
    const code = await runAgentSync({
      name: "no-such-catalog",
      printErr: (m) => {
        stderr += `${m}\n`;
      },
    });
    expect(code).toBe(2);
    // DW-6: the error must distinguish 'catalog label' from 'bundle name'
    // and list the registered remote catalogs so the user can self-correct.
    expect(stderr).toContain("no remote-backed catalog matches 'no-such-catalog'");
    expect(stderr).toContain("CATALOG label");
  });

  test("sync without name or --all returns usage error", async () => {
    const code = await runAgentSync({});
    expect(code).toBe(2);
  });
});
