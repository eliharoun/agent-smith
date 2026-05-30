// tests/cli/agent-catalog-unregister-purge.test.ts
//
// C3.13 (v1-task): `smith agent unregister <path> --purge-clone` — also
// rm -rf the clone dir after removing the registry entry. Must be
// guarded so it can ONLY purge dirs under defaultRemoteRoot() — never
// arbitrary user-supplied paths.
//
// Mirror tests for `smith skill unregister --purge-clone` live in
// skill-catalog-unregister-purge.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromUrl } from "../../src/core/install-from-url";
import { unregister } from "../../src/cli/commands/unregister";
import {
  canonicalRegistryPath,
  loadRegistry,
} from "../../src/io/registry";
import { createBareRemote } from "../fixtures/git-remote-helper";

const VALID_CONFIG = (name: string) =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    description: "Use proactively to test purge-clone.",
    targets: ["claude-code"],
    modelTier: "balanced",
  });

async function seedBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
): Promise<void> {
  await remote.commitFile(`${name}/agent.config.json`, VALID_CONFIG(name));
  await remote.commitFile(`${name}/IDENTITY.md`, `# ${name}\n`);
  await remote.commitFile(`${name}/EXPERTISE.md`, `# Expertise\n`);
  await remote.commitFile(`${name}/SOUL.md`, `# Soul\n`);
  await remote.commitFile(`${name}/USER.md`, `# User\n`);
}

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-purge-clone-"));
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

describe("agent unregister --purge-clone [v1-task C3.13]", () => {
  test("--purge-clone removes catalog AND clone dir", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");
      const r = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });
      expect((await stat(r.cloneDir)).isDirectory()).toBe(true);

      const code = await unregister(r.cloneDir, { purgeClone: true });
      expect(code).toBe(0);

      // Clone dir gone.
      let stillExists = true;
      try {
        await stat(r.cloneDir);
      } catch {
        stillExists = false;
      }
      expect(stillExists).toBe(false);

      // Registry no longer references it.
      const reg = await loadRegistry(canonicalRegistryPath());
      expect(reg.sources.find((s) => s.rootPath === r.cloneDir)).toBeUndefined();
    } finally {
      await remote.cleanup();
    }
  });

  test("without --purge-clone, registry entry is removed but clone dir stays", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");
      const r = await installFromUrl({
        kind: "agent",
        url: remote.url,
        ref: "main",
      });

      const code = await unregister(r.cloneDir);
      expect(code).toBe(0);

      // Clone dir intact.
      expect((await stat(r.cloneDir)).isDirectory()).toBe(true);

      const reg = await loadRegistry(canonicalRegistryPath());
      expect(reg.sources.find((s) => s.rootPath === r.cloneDir)).toBeUndefined();
    } finally {
      await remote.cleanup();
    }
  });

  test("--purge-clone refuses to delete dirs outside defaultRemoteRoot()", async () => {
    // Hand-roll a registry entry whose rootPath sits OUTSIDE the
    // remote-clones root, then try to purge it. The guard must reject.
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-remote-root-"));
    try {
      // Stand up a minimal git repo there so the unregister code can find it.
      const { saveRegistry } = await import("../../src/io/registry");
      const reg = await loadRegistry(canonicalRegistryPath());
      reg.sources.push({
        kind: "registered",
        rootPath: outsideDir,
        label: "outsider",
        gitRemote: "https://example.com/x.git",
        remote: {
          url: "https://example.com/x.git",
          ref: "main",
          lastPulledSha: "0".repeat(40),
          lastPulledAt: new Date().toISOString(),
          lastRemoteSha: "0".repeat(40),
          lastCheckedAt: new Date().toISOString(),
        },
      });
      await saveRegistry(canonicalRegistryPath(), reg);

      // Touch a sentinel inside outsideDir so we can verify it survives.
      await writeFile(join(outsideDir, "SENTINEL"), "do not delete", "utf-8");

      await expect(
        unregister(outsideDir, { purgeClone: true }),
      ).rejects.toThrow(/outside.*remote.*root|purge-clone.*refused/i);

      // Sentinel must still exist.
      expect((await stat(join(outsideDir, "SENTINEL"))).isFile()).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
