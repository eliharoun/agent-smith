// tests/cli/skill-sync.test.ts
//
// C3.12 (v1-task): `smith skill sync` — mirror of `smith agent sync`
// (C3.11). Pulls remote-catalog updates for skill catalogs.
//
// Same three modes as agent sync; same exit-code semantics; same
// label-first / path-fallback resolution policy.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromUrl } from "../../src/core/install-from-url";
import { runSkillSync } from "../../src/cli/commands/skill/sync";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
} from "../../src/io/skill-registry";
import { createBareRemote } from "../fixtures/git-remote-helper";

// Per-test timeout (ms). Bun's default is 5000ms, which is too tight for
// the heavy git work these tests do. Each `createBareRemote()` issues
// ~12 git child-process spawns; each `commitFile()` issues ~4 more
// (add, commit, push, rev-parse); and the actual `runSkillSync()` runs
// a fetch + reset + rev-parse against the bare remote. The `--all`
// case spins up two remotes back-to-back. Under parallel test-worker
// load on macOS, that easily blows past 5s — verified empirically by
// stress-running this file with 5 parallel `bun test` invocations:
// 5/5 hit 5000ms timeouts on the `--all` case. 30s gives ~6× headroom
// at the 95th percentile observed wall time.
const HEAVY_GIT_TIMEOUT_MS = 30_000;

const SKILL_BODY = (name: string) =>
  `---\nname: ${name}\ndescription: Use proactively to test the skill sync flow.\n---\n\n# ${name}\n\nbody\n`;

async function seedSkillBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
  dir = name,
): Promise<string> {
  return await remote.commitFile(`${dir}/SKILL.md`, SKILL_BODY(name));
}

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skill-sync-"));
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

describe("smith skill sync [v1-task C3.12]", () => {
  test("sync <label> pulls new commits and updates lastPulledSha", async () => {
    const remote = await createBareRemote();
    try {
      await seedSkillBundle(remote, "fixture-skill");
      const initial = await installFromUrl({
        kind: "skill",
        url: remote.url,
        ref: "main",
      });
      const before = initial.remote.lastPulledSha;
      const newSha = await remote.commitFile("README.md", "more\n");
      expect(newSha).not.toBe(before);

      const reg0 = await loadSkillRegistry(canonicalSkillRegistryPath());
      const label = reg0.catalogs.find((c) => c.rootPath === initial.cloneDir)?.label;
      expect(label).toBeTruthy();

      const code = await runSkillSync({ name: label! });
      expect(code).toBe(0);

      const reg1 = await loadSkillRegistry(canonicalSkillRegistryPath());
      const updated = reg1.catalogs.find((c) => c.rootPath === initial.cloneDir);
      expect(updated?.remote?.lastPulledSha).toBe(newSha);
      expect(updated?.remote?.lastRemoteSha).toBe(newSha);
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("sync --check updates lastRemoteSha but leaves lastPulledSha untouched", async () => {
    const remote = await createBareRemote();
    try {
      await seedSkillBundle(remote, "fixture-skill");
      const initial = await installFromUrl({
        kind: "skill",
        url: remote.url,
        ref: "main",
      });
      const beforePulled = initial.remote.lastPulledSha;
      const newSha = await remote.commitFile("README.md", "more\n");

      const reg0 = await loadSkillRegistry(canonicalSkillRegistryPath());
      const label = reg0.catalogs.find((c) => c.rootPath === initial.cloneDir)?.label;

      const code = await runSkillSync({ name: label!, check: true });
      expect(code).toBe(0);

      const reg1 = await loadSkillRegistry(canonicalSkillRegistryPath());
      const updated = reg1.catalogs.find((c) => c.rootPath === initial.cloneDir);
      expect(updated?.remote?.lastPulledSha).toBe(beforePulled);
      expect(updated?.remote?.lastRemoteSha).toBe(newSha);
      expect(updated?.remote?.lastCheckedAt).toBeTruthy();
    } finally {
      await remote.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("sync --all syncs every remote-backed skill catalog; partial failures don't abort", async () => {
    const remoteOk = await createBareRemote();
    const remoteBad = await createBareRemote();
    try {
      await seedSkillBundle(remoteOk, "ok-skill");
      await seedSkillBundle(remoteBad, "bad-skill");
      const okInitial = await installFromUrl({
        kind: "skill",
        url: remoteOk.url,
        ref: "main",
      });
      await installFromUrl({
        kind: "skill",
        url: remoteBad.url,
        ref: "main",
      });

      await remoteBad.cleanup();
      const newSha = await remoteOk.commitFile("README.md", "more\n");

      const code = await runSkillSync({ all: true });
      expect(code).toBe(3);

      const reg = await loadSkillRegistry(canonicalSkillRegistryPath());
      const okCatalog = reg.catalogs.find((c) => c.rootPath === okInitial.cloneDir);
      expect(okCatalog?.remote?.lastPulledSha).toBe(newSha);
    } finally {
      await remoteOk.cleanup();
    }
  }, HEAVY_GIT_TIMEOUT_MS);

  test("sync <name> errors when no remote-backed catalog matches", async () => {
    let stderr = "";
    const code = await runSkillSync({
      name: "no-such-catalog",
      printErr: (m) => {
        stderr += `${m}\n`;
      },
    });
    expect(code).toBe(2);
    // DW-6: the error must distinguish 'catalog label' from 'skill name'.
    expect(stderr).toContain("no remote-backed skill catalog matches 'no-such-catalog'");
    expect(stderr).toContain("CATALOG label");
  });

  test("sync without name or --all returns usage error", async () => {
    const code = await runSkillSync({});
    expect(code).toBe(2);
  });
});
