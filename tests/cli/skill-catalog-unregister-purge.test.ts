// tests/cli/skill-catalog-unregister-purge.test.ts
//
// C3.13 (v1-task) — skill mirror of agent purge-clone test.
// See tests/cli/agent-catalog-unregister-purge.test.ts for design notes.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromUrl } from "../../src/core/install-from-url";
import { skillUnregister } from "../../src/cli/commands/skill/unregister";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
} from "../../src/io/skill-registry";
import { createBareRemote } from "../fixtures/git-remote-helper";

const SKILL_BODY = (name: string) =>
  `---\nname: ${name}\ndescription: Use proactively to test skill purge-clone.\n---\n\n# ${name}\n`;

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skill-purge-clone-"));
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

describe("skill unregister --purge-clone [v1-task C3.13]", () => {
  test("--purge-clone removes catalog AND clone dir", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("fixture/SKILL.md", SKILL_BODY("fixture"));
      const r = await installFromUrl({
        kind: "skill",
        url: remote.url,
        ref: "main",
      });
      expect((await stat(r.cloneDir)).isDirectory()).toBe(true);

      const code = await skillUnregister(r.cloneDir, { purgeClone: true });
      expect(code).toBe(0);

      let stillExists = true;
      try {
        await stat(r.cloneDir);
      } catch {
        stillExists = false;
      }
      expect(stillExists).toBe(false);

      const reg = await loadSkillRegistry(canonicalSkillRegistryPath());
      expect(reg.catalogs.find((c) => c.rootPath === r.cloneDir)).toBeUndefined();
    } finally {
      await remote.cleanup();
    }
  });

  test("without --purge-clone, clone dir survives", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("fixture/SKILL.md", SKILL_BODY("fixture"));
      const r = await installFromUrl({
        kind: "skill",
        url: remote.url,
        ref: "main",
      });

      const code = await skillUnregister(r.cloneDir);
      expect(code).toBe(0);
      expect((await stat(r.cloneDir)).isDirectory()).toBe(true);
    } finally {
      await remote.cleanup();
    }
  });

  test("--purge-clone refuses dirs outside defaultRemoteRoot()", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "skill-outside-remote-root-"));
    try {
      const reg = await loadSkillRegistry(canonicalSkillRegistryPath());
      reg.catalogs.push({
        kind: "team-shared",
        rootPath: outsideDir,
        label: "outsider-skill",
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
      await saveSkillRegistry(canonicalSkillRegistryPath(), reg);
      await writeFile(join(outsideDir, "SENTINEL"), "do not delete", "utf-8");

      await expect(
        skillUnregister(outsideDir, { purgeClone: true }),
      ).rejects.toThrow(/outside.*remote.*root|purge-clone.*refused/i);

      expect((await stat(join(outsideDir, "SENTINEL"))).isFile()).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
