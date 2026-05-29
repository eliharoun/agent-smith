// tests/cli/unregister-purge-guard-integration.test.ts
//
// [v1-task RC2-9] Integration coverage at the unregister CLI level for the
// new guard branches added in RC2-9 beyond the pre-existing
// containment check (which is still covered by
// agent-catalog-unregister-purge.test.ts):
//
//   - linked catalog (no remote{}) refused even if rootPath sits under
//     defaultRemoteRoot() (defense against hand-edited registries).
//   - origin URL mismatch refused (catches `git remote set-url`).
//   - origin URL matches recorded remote.url under sameGitRemote
//     normalization → purge proceeds.
//
// Tests stand up real bare repos via createBareRemote so the git
// subprocess actually runs (no readOrigin stub at this layer).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unregister } from "../../src/cli/commands/unregister";
import { installFromUrl } from "../../src/core/install-from-url";
import { canonicalRegistryPath, loadRegistry, saveRegistry } from "../../src/io/registry";
import { defaultRemoteRoot } from "../../src/io/remote-root";
import { createBareRemote } from "../fixtures/git-remote-helper";

const VALID_CONFIG = (name: string) =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    description: "Use proactively to test the purge guard.",
    targets: ["claude-code"],
    modelTier: "balanced",
  });

async function seedBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
): Promise<void> {
  await remote.commitFile(`${name}/agent.config.json`, VALID_CONFIG(name));
  await remote.commitFile(`${name}/IDENTITY.md`, `# ${name}\n`);
  await remote.commitFile(`${name}/EXPERTISE.md`, `# E\n`);
  await remote.commitFile(`${name}/SOUL.md`, `# S\n`);
  await remote.commitFile(`${name}/USER.md`, `# U\n`);
}

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "unregister-purge-guard-"));
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

describe("unregister --purge-clone guard branches [v1-task RC2-9]", () => {
  test("refuses linked catalog even when rootPath is under remote root", async () => {
    // Hand-craft a registry entry with NO remote{} block but rootPath
    // physically inside defaultRemoteRoot(). The pre-RC2-9 containment
    // check would have allowed this; the new mode check must refuse.
    const fakeClone = join(defaultRemoteRoot(), "_local", "fakefake-linked");
    await mkdir(join(fakeClone, ".git"), { recursive: true });
    await writeFile(join(fakeClone, "SENTINEL"), "do-not-delete", "utf-8");

    const reg = await loadRegistry(canonicalRegistryPath());
    reg.sources.push({
      kind: "registered",
      rootPath: fakeClone,
      label: "linked-fake",
      // NB: no remote{} block — this is the 'linked' case the
      // RC2-9 guard must catch.
    });
    await saveRegistry(canonicalRegistryPath(), reg);

    await expect(unregister("linked-fake", { purgeClone: true })).rejects.toThrow(
      /linked.*no remote/i,
    );

    // Sentinel survives → guard refused BEFORE the rm.
    expect((await stat(join(fakeClone, "SENTINEL"))).isFile()).toBe(true);
  });

  test("refuses when 'origin' URL has been repointed", async () => {
    const remoteA = await createBareRemote();
    const remoteB = await createBareRemote();
    try {
      await seedBundle(remoteA, "fixture-agent");
      const r = await installFromUrl({
        kind: "agent",
        url: remoteA.url,
        ref: "main",
      });

      // Repoint origin to a totally different remote behind smith's back.
      const { execFile } = await import("node:child_process");
      await new Promise<void>((res, rej) =>
        execFile("git", ["-C", r.cloneDir, "remote", "set-url", "origin", remoteB.url], (err) =>
          err ? rej(err) : res(),
        ),
      );

      await expect(unregister(r.cloneDir, { purgeClone: true })).rejects.toThrow(
        /origin.*does not match/i,
      );

      // Clone dir survives the refused purge.
      expect((await stat(r.cloneDir)).isDirectory()).toBe(true);
    } finally {
      await remoteA.cleanup();
      await remoteB.cleanup();
    }
  });

  test("happy path: managed + inside + .git present + origin matches → purges", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "happy-agent");
      const r = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      const code = await unregister(r.cloneDir, { purgeClone: true });
      expect(code).toBe(0);
      let stillExists = true;
      try {
        await stat(r.cloneDir);
      } catch {
        stillExists = false;
      }
      expect(stillExists).toBe(false);
    } finally {
      await remote.cleanup();
    }
  });
});
