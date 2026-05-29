// tests/cli/skill-install-from-url.test.ts
//
// C3.10 (v1-task): wire `smith skill install --from <url>` end-to-end.
// Mirrors C3.9 (agent install --from <url>) for the skill registry.
// When --from looks like a git URL (per isLikelyGitUrl), the verb
// delegates to installFromUrl({ kind: "skill", ... }) which clones,
// scans for SKILL.md bundles, and registers the catalog in
// skill-catalogs.json. The skill itself is then installed via the
// normal installSkill() path against the freshly-registered catalog.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSkillInstallCommands } from "../../src/cli/commands/skill/install-cmd";
import { createBareRemote } from "../fixtures/git-remote-helper";

const SKILL_BODY = (name: string) =>
  `---
name: ${name}
description: Use proactively to drive the --from URL install flow.
---

# ${name}

Body.
`;

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skill-install-from-url-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
  // Pre-create the opencode skills dir so copyToPlatforms has a target
  // (it silently skips dirs that don't exist on disk to avoid claiming
  // a platform the user hasn't installed).
  await mkdir(join(home, ".config", "opencode", "skills"), { recursive: true });
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
});

function makeProgram(): Command {
  const program = new Command();
  const skillCmd = program.command("skill");
  registerSkillInstallCommands(skillCmd, {
    homeDirOverride: home,
    wrapDepsOverride: {
      exit: ((): never => {
        // no-op: don't kill the bun-test runner. Cast satisfies the
        // `(code: number) => never` signature on the wrap deps; the
        // callers tolerate fallthrough via the "unreachable" throw they
        // emit immediately after exit returns.
        return undefined as never;
      }) as (code: number) => never,
    },
  });
  return program;
}

describe("smith skill install --from <url> [v1-task C3.10]", () => {
  test("clones remote, registers skill catalog, installs the only skill", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("fixture-skill/SKILL.md", SKILL_BODY("fixture-skill"));

      const program = makeProgram();
      await program.parseAsync(["skill", "install", "--from", remote.url], { from: "user" });

      // installed-skills.json should now record the install.
      const installed = JSON.parse(
        await Bun.file(join(home, ".config", "agent-smith", "installed-skills.json")).text(),
      );
      expect(installed.installed.some((e: { name: string }) => e.name === "fixture-skill")).toBe(
        true,
      );

      // skill-catalogs.json should now have a remote-backed entry.
      const reg = JSON.parse(
        await Bun.file(join(home, ".config", "agent-smith", "skill-catalogs.json")).text(),
      );
      expect(reg.schemaVersion).toBe(2);
      expect(
        reg.catalogs.some((c: { remote?: { url: string } }) => c.remote?.url === remote.url),
      ).toBe(true);
    } finally {
      await remote.cleanup();
    }
  });

  test("errors with disambiguation hint when --from URL has >1 skill and no ref", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("a/SKILL.md", SKILL_BODY("alpha-skill"));
      await remote.commitFile("b/SKILL.md", SKILL_BODY("beta-skill"));

      const errs: string[] = [];
      const origErr = console.error;
      console.error = (msg?: unknown) => {
        if (typeof msg === "string") errs.push(msg);
      };
      try {
        const program = makeProgram();
        try {
          await program.parseAsync(["skill", "install", "--from", remote.url], { from: "user" });
        } catch (e) {
          // wrap()'s "unreachable" throw fires after the no-op exit stub
          // returns; absorb it so we can assert on captured stderr.
          if ((e as Error).message !== "unreachable") throw e;
        }
      } finally {
        console.error = origErr;
      }
      const joined = errs.join("\n");
      expect(joined).toContain("alpha-skill");
      expect(joined).toContain("beta-skill");
      expect(joined).toMatch(/install <?ref>?|specify which/i);
    } finally {
      await remote.cleanup();
    }
  });

  test("installs the named skill when --from URL has multiple and ref is given", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("a/SKILL.md", SKILL_BODY("alpha-skill"));
      await remote.commitFile("b/SKILL.md", SKILL_BODY("beta-skill"));

      const program = makeProgram();
      await program.parseAsync(["skill", "install", "beta-skill", "--from", remote.url], {
        from: "user",
      });

      const installed = JSON.parse(
        await Bun.file(join(home, ".config", "agent-smith", "installed-skills.json")).text(),
      );
      expect(installed.installed.some((e: { name: string }) => e.name === "beta-skill")).toBe(true);
      expect(installed.installed.some((e: { name: string }) => e.name === "alpha-skill")).toBe(
        false,
      );
    } finally {
      await remote.cleanup();
    }
  });

  test("local path --from still works (regression: URL branch must not break path branch)", async () => {
    // Build a local skill dir and pass it via --from. This is the
    // pre-existing C3.10 behavior we must preserve.
    const skillDir = await mkdtemp(join(tmpdir(), "skill-local-"));
    try {
      await Bun.write(join(skillDir, "SKILL.md"), SKILL_BODY("local-skill"));

      const program = makeProgram();
      await program.parseAsync(["skill", "install", "--from", skillDir], { from: "user" });

      const installed = JSON.parse(
        await Bun.file(join(home, ".config", "agent-smith", "installed-skills.json")).text(),
      );
      expect(installed.installed.some((e: { name: string }) => e.name === "local-skill")).toBe(
        true,
      );
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });
});
