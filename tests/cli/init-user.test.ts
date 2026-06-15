// Unit tests for initUserImpl, the DI seam behind `smith init-user`.
//
// Closes CLI-6: previously the EDITOR env var was spawned as a single
// argv token (so `EDITOR="code --wait"` failed to find the binary
// `code --wait`), and there was no pre-flight check that the user
// manifest exists — vi happily opened an empty buffer at the canonical
// path, which on save would create the file outside `smith init`'s
// structured initialization.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initUserImpl } from "../../src/cli/commands/init-user";
import { SmithError } from "../../src/core/smith-error";

const ORIG_EDITOR = process.env.EDITOR;

beforeEach(() => {
  delete process.env.EDITOR;
});

afterEach(() => {
  if (ORIG_EDITOR === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = ORIG_EDITOR;
});

describe("initUserImpl", () => {
  test("EDITOR=vi spawns ['vi', <path>]", async () => {
    process.env.EDITOR = "vi";
    let captured: string[] = [];
    const code = await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      userPath: "/tmp/USER.md",
    });
    expect(code).toBe(0);
    expect(captured).toEqual(["vi", "/tmp/USER.md"]);
  });

  test("EDITOR='code --wait' splits whitespace into separate argv tokens", async () => {
    process.env.EDITOR = "code --wait";
    let captured: string[] = [];
    await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      userPath: "/tmp/USER.md",
    });
    // Critical: 'code --wait' must NOT be passed as a single token —
    // that would attempt to exec a binary literally named "code --wait".
    expect(captured).toEqual(["code", "--wait", "/tmp/USER.md"]);
  });

  test("EDITOR with multiple flags passes them all through", async () => {
    process.env.EDITOR = "emacs -nw --no-splash";
    let captured: string[] = [];
    await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      userPath: "/tmp/USER.md",
    });
    expect(captured).toEqual(["emacs", "-nw", "--no-splash", "/tmp/USER.md"]);
  });

  test("missing manifest -> seedManifest is called with userPath, then editor spawns", async () => {
    process.env.EDITOR = "vi";
    const seedCalls: string[] = [];
    let captured: string[] = [];
    const code = await initUserImpl({
      manifestExists: async () => false,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      seedManifest: async (path) => {
        seedCalls.push(path);
      },
      userPath: "/tmp/USER.md",
    });
    expect(code).toBe(0);
    // Bootstrap path: seedManifest invoked exactly once with userPath
    // before the editor is spawned.
    expect(seedCalls).toEqual(["/tmp/USER.md"]);
    expect(captured).toEqual(["vi", "/tmp/USER.md"]);
  });

  test("existing manifest -> seedManifest NOT called, editor spawns directly", async () => {
    process.env.EDITOR = "vi";
    const seedCalls: string[] = [];
    let captured: string[] = [];
    const code = await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      seedManifest: async (path) => {
        seedCalls.push(path);
      },
      userPath: "/tmp/USER.md",
    });
    expect(code).toBe(0);
    // Happy path: existing manifest must NOT be re-seeded; that would
    // overwrite the user's content.
    expect(seedCalls).toEqual([]);
    expect(captured).toEqual(["vi", "/tmp/USER.md"]);
  });

  test("missing manifest + editor ENOENT -> seedManifest still ran (stub persists)", async () => {
    // Documents the intentional side-effect: when the editor spawn
    // fails with ENOENT, the seeded stub remains on disk. This lets
    // the user re-run `smith init-user` (or any other smith command)
    // and the stub is picked up as their starting USER.md.
    process.env.EDITOR = "no-such-editor-zzzz";
    const seedCalls: string[] = [];
    const caught = await initUserImpl({
      manifestExists: async () => false,
      spawnEditor: async () => {
        const e = new Error("spawn no-such-editor-zzzz ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      seedManifest: async (path) => {
        seedCalls.push(path);
      },
      userPath: "/tmp/USER.md",
    }).catch((e) => e);
    expect(caught).toBeInstanceOf(SmithError);
    // Critical: seed ran BEFORE the editor failed, so the stub is on disk.
    expect(seedCalls).toEqual(["/tmp/USER.md"]);
  });

  test("ENOENT on spawn -> rethrown as SmithError naming the binary and EDITOR", async () => {
    process.env.EDITOR = "no-such-editor-zzzz";
    const caught = await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async () => {
        const e = new Error("spawn no-such-editor-zzzz ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      userPath: "/tmp/USER.md",
    }).catch((e) => e);
    expect(caught).toBeInstanceOf(SmithError);
    const err = caught as SmithError;
    expect(err.payload.code).toBe("usage-error");
    if (err.payload.code === "usage-error") {
      // The wrapped message must surface BOTH the offending binary
      // name and an EDITOR cue so the user knows what to fix.
      expect(err.payload.message).toMatch(/no-such-editor-zzzz/);
      expect(err.payload.message).toMatch(/EDITOR/);
      // Item B1: a runnable Try: suggestion that sets EDITOR and re-runs.
      expect(err.payload.suggestedCommand).toBe(
        "EDITOR=$(command -v vim || command -v nano) smith init-user",
      );
    }
  });

  test("non-ENOENT spawn errors are propagated unwrapped", async () => {
    process.env.EDITOR = "vi";
    const caught = await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async () => {
        throw new Error("Editor exited 1");
      },
      userPath: "/tmp/USER.md",
    }).catch((e) => e);
    // Not a SmithError: a non-zero editor exit isn't a usage error,
    // it's a normal "user quit without saving" outcome that we should
    // surface verbatim rather than dressing up as actionable advice.
    expect(caught).not.toBeInstanceOf(SmithError);
    expect((caught as Error).message).toMatch(/Editor exited 1/);
  });

  test("EDITOR unset defaults to 'vi'", async () => {
    let captured: string[] = [];
    await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async (argv) => {
        captured = argv;
        return 0;
      },
      userPath: "/tmp/USER.md",
    });
    expect(captured).toEqual(["vi", "/tmp/USER.md"]);
  });
});

describe("initUserImpl bridge", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "init-user-bridge-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writes bridged JIRA_*/CONFLUENCE_* vars when SMITH_ATLASSIAN_* set in env", async () => {
    process.env.EDITOR = "true";
    process.env.SMITH_ATLASSIAN_EMAIL = "alice@acme.com";
    process.env.SMITH_ATLASSIAN_API_TOKEN = "ATATT3xFfGF0test";
    process.env.SMITH_ATLASSIAN_BASE_URL = "https://acme.atlassian.net";

    const envPath = join(dir, ".env");
    // Pre-seed the .env with SMITH_* vars so the bridge can read them
    await writeFile(
      envPath,
      "SMITH_ATLASSIAN_EMAIL=alice@acme.com\nSMITH_ATLASSIAN_API_TOKEN=ATATT3xFfGF0test\nSMITH_ATLASSIAN_BASE_URL=https://acme.atlassian.net\n",
    );

    let bridgeCalled = false;
    const code = await initUserImpl({
      manifestExists: async () => true,
      spawnEditor: async () => 0,
      userPath: join(dir, "USER.md"),
      bridgeEnv: async () => {
        // Simulate the bridge write
        const { bridgeAtlassianAuthToPerProductEnv } = await import(
          "../../src/io/atlassian-bridge"
        );
        const { upsertEnvLines } = await import("../../src/io/dotenv-roundtrip");
        const raw = await readFile(envPath, "utf8");
        const bridged = bridgeAtlassianAuthToPerProductEnv({
          email: "alice@acme.com",
          token: "ATATT3xFfGF0test",
          baseUrl: "https://acme.atlassian.net",
        });
        const updated = upsertEnvLines(raw, bridged as unknown as Record<string, string | null>);
        await writeFile(envPath, updated);
        bridgeCalled = true;
      },
    });

    expect(code).toBe(0);
    expect(bridgeCalled).toBe(true);
    const content = await readFile(envPath, "utf8");
    expect(content).toContain("JIRA_URL=https://acme.atlassian.net");
    expect(content).toContain("JIRA_USERNAME=alice@acme.com");
    expect(content).toContain("JIRA_API_TOKEN=ATATT3xFfGF0test");
    expect(content).toContain("CONFLUENCE_URL=https://acme.atlassian.net/wiki");
    expect(content).toContain("CONFLUENCE_USERNAME=alice@acme.com");
    expect(content).toContain("CONFLUENCE_API_TOKEN=ATATT3xFfGF0test");

    // Cleanup env vars
    delete process.env.SMITH_ATLASSIAN_EMAIL;
    delete process.env.SMITH_ATLASSIAN_API_TOKEN;
    delete process.env.SMITH_ATLASSIAN_BASE_URL;
  });
});
