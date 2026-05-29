// Black-box smoke test of the `smith agent ...` commander wiring.
// Mirrors tests/cli/skill-cli-wiring.test.ts: spawns `bun src/index.ts`
// with a tmp HOME (and stripped XDG_* vars) so the canonical registry path
// lands inside the temp dir and never pollutes the maintainer's home.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerAgentCommands, resolveCatalogArg } from "../../src/cli/commands/agent/register-commands";
import type { Registry } from "../../src/io/registry";
import { SmithError } from "../../src/core/smith-error";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-agent-wiring-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function runSmith(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Strip every XDG_* var from the inherited env. On Linux CI, XDG_CONFIG_HOME
  // (and friends) override the homedir-derived ${HOME}/.config/... path that
  // smith uses for registry.json — which would let the subprocess escape our
  // tmp HOME isolation and stomp the maintainer's real config.
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

describe("cli/agent wiring — structure", () => {
  test("registers all expected subcommands", () => {
    const parent = new Command("agent");
    registerAgentCommands(parent);
    const names = parent.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      "catalogs",
      "destroy",
      "init",
      "install",
      "install-all",
      "list",
      "reconfigure",
      "register",
      "sync",
      "uninstall",
      "uninstall-all",
      "unregister",
      "validate",
    ]);
  });
});

describe("cli/agent wiring — commander smoke test", () => {
  test("`smith agent catalogs` exits 0 against an isolated HOME", async () => {
    // Against a fresh tmp HOME there's no registry.json yet, so loadRegistry
    // returns defaultRegistry() which seeds a single user-global source. The
    // catalogs verb should render that line. We assert exit 0 + non-empty
    // stdout to keep the test robust to label/format tweaks.
    const { code, stdout } = await runSmith("agent", "catalogs");
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).toContain("user-global");
  });

  test("`smith agent list` exits 0 against an isolated HOME", async () => {
    const { code } = await runSmith("agent", "list");
    expect(code).toBe(0);
  });

  test("`smith agent register /tmp/bogus-path --kind bogus` exits non-zero (commander rejects invalid choice)", async () => {
    const { code, stderr } = await runSmith(
      "agent",
      "register",
      "/tmp/bogus-path",
      "--kind",
      "bogus",
    );
    expect(code).not.toBe(0);
    // Commander's choices() error is something like:
    //   "error: option '--kind <kind>' argument 'bogus' is invalid. Allowed choices are ..."
    expect(stderr).toMatch(/--kind/);
    expect(stderr.toLowerCase()).toMatch(/invalid|allowed choices/);
  });
});

describe("resolveCatalogArg", () => {
  const teamCatalogPath = "/tmp/team-agents-fixture";
  const registry: Registry = {
    schemaVersion: 2,
    sources: [
      { kind: "registered", rootPath: teamCatalogPath, label: "team-agents" },
      {
        kind: "user-global",
        rootPath: "/Users/x/.config/agent-smith/agents",
        label: "user-global:/Users/x/.config/agent-smith/agents",
      },
    ],
  };

  test("resolves by label", () => {
    const result = resolveCatalogArg("team-agents", registry);
    expect(result.rootPath).toBe(teamCatalogPath);
    expect(result.kind).toBe("registered");
  });

  test("resolves by absolute path", () => {
    const result = resolveCatalogArg(teamCatalogPath, registry);
    expect(result.label).toBe("team-agents");
  });

  test("treats value containing slash as path even without leading slash", () => {
    const cwd = process.cwd();
    const rel = "./relative-team-agents";
    const reg2: Registry = {
      schemaVersion: 2,
      sources: [
        { kind: "registered", rootPath: join(cwd, "relative-team-agents"), label: "rel" },
      ],
    };
    const result = resolveCatalogArg(rel, reg2);
    expect(result.label).toBe("rel");
  });

  test("throws not-found SmithError for unregistered label", () => {
    let err: unknown = null;
    try {
      resolveCatalogArg("nonexistent", registry);
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(SmithError);
    if (err instanceof SmithError) {
      expect(err.payload.code).toBe("not-found");
      if (err.payload.code === "not-found") {
        expect(err.payload.what).toBe("agent catalog");
        expect(err.payload.identifier).toBe("nonexistent");
        expect(err.payload.suggestedCommand).toBe("smith agent catalogs");
      }
    }
  });

  test("throws not-found for unregistered path", () => {
    let err: unknown = null;
    try {
      resolveCatalogArg("/tmp/never-registered", registry);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SmithError);
    if (err instanceof SmithError) {
      expect(err.payload.code).toBe("not-found");
    }
  });
});

describe("cli/agent init --catalog — commander smoke", () => {
  test("smoke: --catalog flag is recognized by Commander", () => {
    const program = new Command();
    const agent = program.command("agent");
    registerAgentCommands(agent);
    const initCmd = agent.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
    const hasOption = initCmd!.options.some((o) => o.long === "--catalog");
    expect(hasOption).toBe(true);
  });
});
