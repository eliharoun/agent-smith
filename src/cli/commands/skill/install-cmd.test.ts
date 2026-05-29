import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerSkillInstallCommands } from "./install-cmd";

describe("registerSkillInstallCommands", () => {
  it("registers `skill validate` subcommand", () => {
    const prog = new Command();
    const skill = prog.command("skill");
    registerSkillInstallCommands(skill);
    const sub = skill.commands.find((c) => c.name() === "validate");
    expect(sub).toBeDefined();
    expect(sub!.description()).toContain("Validate");
  });

  it("registers install / update / uninstall / validate", () => {
    const prog = new Command();
    const skill = prog.command("skill");
    registerSkillInstallCommands(skill);
    const names = skill.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["install", "sync", "uninstall", "update", "validate"]);
  });
});
