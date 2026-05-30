import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSkillInstallCommands } from "../../src/cli/commands/skill/install-cmd";
import { createBareRemote } from "../fixtures/git-remote-helper";

const SKILL = (n: string) => `---\nname: ${n}\ndescription: ${n} for e2e.\n---\n# ${n}\n`;

let home: string; let prevCfg: string | undefined; let prevState: string | undefined;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "e2e-multi-"));
  prevCfg = process.env.XDG_CONFIG_HOME; prevState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home; process.env.XDG_STATE_HOME = home;
});
afterEach(async () => {
  prevCfg === undefined ? delete process.env.XDG_CONFIG_HOME : (process.env.XDG_CONFIG_HOME = prevCfg);
  prevState === undefined ? delete process.env.XDG_STATE_HOME : (process.env.XDG_STATE_HOME = prevState);
  await rm(home, { recursive: true, force: true });
});

describe("e2e: multi-skill discover → select → install (incl. kiro)", () => {
  test("installs a chosen subset to chosen platforms incl. kiro", async () => {
    const remote = await createBareRemote();
    try {
      await remote.commitFile("a/SKILL.md", SKILL("alpha"));
      await remote.commitFile("b/SKILL.md", SKILL("beta"));
      await remote.commitFile("c/SKILL.md", SKILL("gamma"));
      const program = new Command();
      registerSkillInstallCommands(program.command("skill"), {
        homeDirOverride: home,
        wrapDepsOverride: { exit: (() => undefined as never) as (code: number) => never },
      });
      await program.parseAsync(
        ["skill", "install", "--from", remote.url, "--skills", "alpha,gamma", "--targets", "opencode,kiro"],
        { from: "user" },
      );
      const installed = JSON.parse(await Bun.file(join(home, ".config", "agent-smith", "installed-skills.json")).text());
      const names = installed.installed.map((e: { name: string }) => e.name).sort();
      expect(names).toEqual(["alpha", "gamma"]);
      for (const n of ["alpha", "gamma"]) {
        const e = installed.installed.find((x: { name: string }) => x.name === n);
        expect(e.installedPaths.kiro).toBeDefined();
        expect(existsSync(join(home, ".kiro", "skills", n, "SKILL.md"))).toBe(true);
        expect(existsSync(join(home, ".config", "opencode", "skills", n, "SKILL.md"))).toBe(true);
      }
      expect(names).not.toContain("beta");
      const reg = JSON.parse(await Bun.file(join(home, ".config", "agent-smith", "skill-catalogs.json")).text());
      expect(reg.catalogs.some((c: { remote?: { url: string } }) => c.remote?.url === remote.url)).toBe(true);
    } finally { await remote.cleanup(); }
  });
});
