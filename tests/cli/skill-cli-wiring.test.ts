// Black-box smoke test of the `smith skill ...` commander wiring.
// Mirrors the hermetic-cli invocation pattern: spawn `bun src/index.ts` with a
// tmp HOME so the canonical registry path lands inside the temp dir and never
// pollutes the maintainer's home.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-skill-wiring-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function runSmith(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Strip every XDG_* var from the inherited env. On Linux CI, XDG_CONFIG_HOME
  // (and friends) override the homedir-derived ${HOME}/.config/... path that
  // smith uses for skill-catalogs.json — which would let the subprocess
  // escape our tmp HOME isolation and stomp the maintainer's real config.
  // Stripping here keeps the test hermetic on every platform.
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

describe("cli/skill — commander wiring smoke test", () => {
  test("`smith skill list` against the default registry succeeds (no crashes)", async () => {
    // Default registry seeds atlassian-skills pointing at a clone path under
    // our tmp HOME. If network is available, the clone succeeds and skills are
    // listed; if not, the error is caught and "(no skills found)" is printed.
    // Either way, exit code is 0. The point of this test is the wiring.
    const { code } = await runSmith("skill", "list");
    expect(code).toBe(0);
  });

  test("`smith skill register /x --kind bogus` exits non-zero (commander rejects invalid choice)", async () => {
    const { code, stderr } = await runSmith("skill", "register", "/tmp/x", "--kind", "bogus");
    expect(code).not.toBe(0);
    // Commander's choices() error is something like:
    //   "error: option '--kind <kind>' argument 'bogus' is invalid. Allowed choices are ..."
    expect(stderr).toMatch(/--kind/);
    expect(stderr.toLowerCase()).toMatch(/invalid|allowed choices/);
  });

  test("`smith skill register /x --kind example-pack` exits non-zero (invalid kind not in choices)", async () => {
    const { code, stderr } = await runSmith(
      "skill",
      "register",
      "/tmp/x",
      "--kind",
      "example-pack",
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--kind/);
  });
});
