// tests/cli/agent-install-from-url.test.ts
//
// C3.9 (v1-task): wire `smith agent install --from <url>` end-to-end.
// The orchestrator (installFromUrl, C3.8) does the clone + register; the
// CLI verb auto-installs the bundle when exactly one is found, and emits
// an actionable error pointing the user at the disambiguated form when
// more than one bundle lives in the repo.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";
import { createBareRemote } from "../fixtures/git-remote-helper";

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-install-from-url-"));
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

const VALID_CONFIG = (name: string) =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    description: "Use proactively to test the --from URL install flow.",
    targets: ["claude-code"],
    modelTier: "balanced",
  });

async function seedBundle(
  remote: { commitFile: (p: string, c: string) => Promise<string> },
  name: string,
  dir = name,
): Promise<void> {
  await remote.commitFile(`${dir}/agent.config.json`, VALID_CONFIG(name));
  await remote.commitFile(`${dir}/IDENTITY.md`, `# ${name}\n\nYou exist.\n`);
  await remote.commitFile(`${dir}/EXPERTISE.md`, `# Expertise\n\nYou do.\n`);
  await remote.commitFile(`${dir}/SOUL.md`, `# Soul\n\nYou speak.\n`);
  await remote.commitFile(`${dir}/USER.md`, `# User\n\nYou note.\n`);
}

describe("smith agent install --from <url> [v1-task C3.9]", () => {
  test("clones remote, registers catalog, installs the only bundle in the repo", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "fixture-agent");

      const logs: string[] = [];
      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: (m) => logs.push(m),
        printErr: (m) => errs.push(m),
      });

      expect(code).toBe(0);
      // The auto-resolved bundle name should appear in the install output.
      const joined = [...logs, ...errs].join("\n");
      expect(joined).toContain("fixture-agent");
    } finally {
      await remote.cleanup();
    }
  });

  test("errors with disambiguation hint when --from URL has >1 bundle and no name", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const errs: string[] = [];
      const code = await install({
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: () => {},
        printErr: (m) => errs.push(m),
      });

      expect(code).not.toBe(0);
      const joined = errs.join("\n");
      expect(joined).toContain("alpha-agent");
      expect(joined).toContain("beta-agent");
      expect(joined).toMatch(/install <?name>?|specify which/i);
    } finally {
      await remote.cleanup();
    }
  });

  test("installs the named bundle when --from URL has multiple and name is given", async () => {
    const remote = await createBareRemote();
    try {
      await seedBundle(remote, "alpha-agent", "a");
      await seedBundle(remote, "beta-agent", "b");

      const code = await install({
        name: "beta-agent",
        from: remote.url,
        ref: "main",
        noRefreshHooks: true,
        print: () => {},
        printErr: () => {},
      });

      expect(code).toBe(0);
    } finally {
      await remote.cleanup();
    }
  });
});
