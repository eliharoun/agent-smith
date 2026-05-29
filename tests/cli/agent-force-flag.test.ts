// Task 1.5: assert --force is registered on each agent verb that consumes it.
// Drives the commander program directly (no subprocess) by mounting the
// agent command group on a fresh program and inspecting --help text.

import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerAgentCommands } from "../../src/cli/commands/agent/register-commands";

function helpFor(verb: string): string {
  const program = new Command();
  const agent = program.command("agent");
  // Mount with rethrow so help-write doesn't kill the test runner.
  registerAgentCommands(agent, {
    wrapDepsOverride: {
      rethrow: true,
      // The wrap signature requires `exit` to return `never`. We never
      // expect it to be called from a help-only path; throw if it is so
      // any unexpected call surfaces loudly in tests.
      exit: ((code: number): never => {
        throw new Error(`unexpected exit(${code})`);
      }) as (code: number) => never,
    },
  });
  // Find the subcommand and capture its help text.
  const sub = agent.commands.find((c) => c.name() === verb);
  if (!sub) throw new Error(`subcommand 'agent ${verb}' not registered`);
  return sub.helpInformation();
}

describe("agent verbs register --force", () => {
  test("agent install --help mentions --force", () => {
    expect(helpFor("install")).toContain("--force");
  });

  test("agent install-all --help mentions --force", () => {
    expect(helpFor("install-all")).toContain("--force");
  });

  test("agent uninstall --help mentions --force", () => {
    expect(helpFor("uninstall")).toContain("--force");
  });

  test("agent uninstall-all --help mentions --force", () => {
    expect(helpFor("uninstall-all")).toContain("--force");
  });

  test("agent destroy --help mentions --force (pre-existing flag)", () => {
    expect(helpFor("destroy")).toContain("--force");
  });
});

describe("agent verbs register --platform-conventions", () => {
  test("agent install --help mentions --platform-conventions", () => {
    expect(helpFor("install")).toContain("--platform-conventions");
    expect(helpFor("install")).toContain("--no-platform-conventions");
  });

  test("agent install-all --help mentions --platform-conventions", () => {
    expect(helpFor("install-all")).toContain("--platform-conventions");
    expect(helpFor("install-all")).toContain("--no-platform-conventions");
  });
});
