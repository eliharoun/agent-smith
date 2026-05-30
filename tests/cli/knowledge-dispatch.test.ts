// Black-box smoke test of the `smith knowledge ...` commander wiring (CLI-20).
// Mirrors tests/cli/skill-cli-wiring.test.ts: spawn `bun src/index.ts` with a
// tmp HOME so any registry path lands inside the temp dir and never pollutes
// the maintainer's home.
//
// Commander's program state can't be cleanly reset within a single process,
// so per-subcommand wiring is exercised end-to-end via subprocess spawn.
// Per-subcommand business logic stays covered by the inner unit tests in
// tests/cli/knowledge-{add,fetch,list,validate}.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-knowledge-wiring-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function runSmith(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: Record<string, string> = { HOME: home };
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "HOME" || k.startsWith("XDG_") || v === undefined) continue;
    env[k] = v;
  }
  const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("cli/knowledge — commander wiring smoke test (CLI-20)", () => {
  test("rejects an unknown flag on `knowledge fetch`", async () => {
    const { code, stderr } = await runSmith(
      "knowledge",
      "fetch",
      "some-agent",
      "--soruce",
      "x",
    );
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/unknown option.*--soruce/);
  });

  test("rejects an unknown subcommand", async () => {
    const { code, stderr } = await runSmith("knowledge", "bogus");
    expect(code).not.toBe(0);
    // Commander rejects unrecognized positional input on the parent; because
    // the parent has its own .action() (so bare `knowledge` can print a
    // usage-error instead of silently exiting 0), commander's exact wording
    // is "too many arguments" rather than "unknown command". Either is a
    // clear usage-error signal — assert both possibilities so the test
    // doesn't trip if commander's wording changes.
    expect(stderr.toLowerCase()).toMatch(/unknown command|too many arguments/);
  });

  test("`knowledge --help` lists the four subcommands", async () => {
    const { code, stdout } = await runSmith("knowledge", "--help");
    expect(code).toBe(0);
    for (const sub of ["list", "fetch", "add", "validate"]) {
      expect(stdout).toContain(sub);
    }
  });

  test("`knowledge add --help` lists the add-specific options", async () => {
    const { code, stdout } = await runSmith("knowledge", "add", "--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(/--id/);
    expect(stdout).toMatch(/--delivery/);
    expect(stdout).toMatch(/--description/);
    expect(stdout).toMatch(/--optional/);
  });

  test("`knowledge` with no args prints a usage error listing the subcommands", async () => {
    const { code, stderr } = await runSmith("knowledge");
    expect(code).toBe(2);
    expect(stderr).toMatch(/requires a subcommand/);
    for (const sub of ["list", "fetch", "add", "validate"]) {
      expect(stderr).toContain(sub);
    }
  });
});
