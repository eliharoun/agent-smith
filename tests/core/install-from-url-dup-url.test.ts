// tests/core/install-from-url-dup-url.test.ts
//
// RC2-4: installFromUrl hard-errors when any existing source OR skill
// catalog already points to the same git remote (sameGitRemote-equivalent).
// No escape hatch — users must `unregister --purge-clone` first.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromUrl } from "../../src/core/install-from-url";
import { SmithError } from "../../src/core/smith-error";
import { canonicalRegistryPath, loadRegistry, saveRegistry } from "../../src/io/registry";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../../src/io/skill-registry";
import { createBareRemote } from "../fixtures/git-remote-helper";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "install-dup-url-"));
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

describe("installFromUrl duplicate-URL guard [v1-task RC2-4]", () => {
  test("agent: rejects URL already present in agent registry", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "agents/x/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "x",
          description: "x",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      // Pre-seed the agent registry with a source that already claims this URL.
      const reg = await loadRegistry(canonicalRegistryPath());
      reg.sources.push({
        kind: "registered",
        label: "preexisting/x",
        rootPath: "/tmp/preexisting-x",
        gitRemote: remote.url,
        remote: {
          url: remote.url,
          ref: "main",
          lastPulledSha: "deadbeef".padEnd(40, "0"),
          lastPulledAt: new Date().toISOString(),
          lastRemoteSha: "deadbeef".padEnd(40, "0"),
          lastCheckedAt: new Date().toISOString(),
        },
      });
      await saveRegistry(canonicalRegistryPath(), reg);

      let err: unknown;
      try {
        await installFromUrl({ kind: "agent", url: remote.url, ref: "main" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SmithError);
      const msg = String(err);
      expect(msg).toContain("preexisting/x");
      expect(msg).toContain(remote.url);
    } finally {
      await remote.cleanup();
    }
  });

  test("skill: rejects URL already present in skill registry", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("y/SKILL.md", "---\nname: y\n---\nbody\n");

      const sreg = await loadSkillRegistry(canonicalSkillRegistryPath());
      sreg.catalogs.push({
        kind: "team-shared",
        label: "preexisting/y",
        rootPath: "/tmp/preexisting-y",
        gitRemote: remote.url,
        remote: {
          url: remote.url,
          ref: "main",
          lastPulledSha: "deadbeef".padEnd(40, "0"),
          lastPulledAt: new Date().toISOString(),
          lastRemoteSha: "deadbeef".padEnd(40, "0"),
          lastCheckedAt: new Date().toISOString(),
        },
      });
      await saveSkillRegistry(canonicalSkillRegistryPath(), sreg);

      let err: unknown;
      try {
        await installFromUrl({ kind: "skill", url: remote.url, ref: "main" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SmithError);
      const msg = String(err);
      expect(msg).toContain("preexisting/y");
    } finally {
      await remote.cleanup();
    }
  });

  test("cross-kind: agent install rejects URL already present as skill catalog", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "agents/x/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "x",
          description: "x",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      const sreg = await loadSkillRegistry(canonicalSkillRegistryPath());
      sreg.catalogs.push({
        kind: "team-shared",
        label: "cross/x",
        rootPath: "/tmp/cross-x",
        gitRemote: remote.url,
        remote: {
          url: remote.url,
          ref: "main",
          lastPulledSha: "deadbeef".padEnd(40, "0"),
          lastPulledAt: new Date().toISOString(),
          lastRemoteSha: "deadbeef".padEnd(40, "0"),
          lastCheckedAt: new Date().toISOString(),
        },
      });
      await saveSkillRegistry(canonicalSkillRegistryPath(), sreg);

      let err: unknown;
      try {
        await installFromUrl({ kind: "agent", url: remote.url, ref: "main" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SmithError);
      expect(String(err)).toContain("cross/x");
    } finally {
      await remote.cleanup();
    }
  });

  test("URL normalization: .git suffix variation counts as duplicate", async () => {
    // Unit-level verification that the install path delegates to sameGitRemote
    // (already property-tested for .git/scheme/case in tests/io/git-url.test.ts).
    // We pre-seed an https-style URL with .git suffix and verify the seeded
    // entry would collide with the same URL without suffix — no actual clone
    // happens because the dup-guard fires first.
    const seededUrl = "https://github.com/owner/repo.git";
    const incomingUrl = "https://github.com/owner/repo";

    const reg = await loadRegistry(canonicalRegistryPath());
    reg.sources.push({
      kind: "registered",
      label: "normalized/x",
      rootPath: "/tmp/normalized-x",
      gitRemote: seededUrl,
      remote: {
        url: seededUrl,
        ref: "main",
        lastPulledSha: "deadbeef".padEnd(40, "0"),
        lastPulledAt: new Date().toISOString(),
        lastRemoteSha: "deadbeef".padEnd(40, "0"),
        lastCheckedAt: new Date().toISOString(),
      },
    });
    await saveRegistry(canonicalRegistryPath(), reg);

    let err: unknown;
    try {
      await installFromUrl({ kind: "agent", url: incomingUrl, ref: "main" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SmithError);
    expect(String(err)).toContain("normalized/x");
  });

  test("no collision: succeeds normally when URL is novel", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile(
        "agents/fresh/agent.config.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "fresh",
          description: "fresh",
          targets: ["claude-code"],
          persona: { sections: [] },
        }),
      );

      const result = await installFromUrl({ kind: "agent", url: remote.url, ref: "main" });
      expect(result.bundles).toContain("fresh");
    } finally {
      await remote.cleanup();
    }
  });
});
