// Phase-6 unit tests for `smith agent reconfigure <name>` — the retroactive
// grant/revoke flow for refresh hooks. Asserts manifest mutations alongside
// real per-platform side effects on disk (no mocks). Each test gets its own
// tmp tree under `os.tmpdir()` and tears it down in `afterEach`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import matter from "gray-matter";
import {
  reconfigureAgent,
  type ReconfigureDeps,
} from "../../src/cli/commands/agent/reconfigure";
import { registerAgentCommands } from "../../src/cli/commands/agent/register-commands";
import {
  readRefreshManifest,
  writeRefreshManifest,
  type RefreshManifest,
} from "../../src/core/knowledge/refresh-manifest";
import { SmithError } from "../../src/core/smith-error";
import type { InstallPaths, Target } from "../../src/core/types";
import { readOpencodePluginSentinel } from "../../src/io/opencode-plugin";

const AGENT = "my-agent";

interface Tree {
  home: string; // agentSmithHome
  paths: InstallPaths;
  codexHome: string;
  opencodeHome: string;
  deps: ReconfigureDeps;
}

async function makeTree(): Promise<Tree> {
  const root = await mkdtemp(join(tmpdir(), "smith-reconfigure-"));
  const home = join(root, "agent-smith");
  const claudeDir = join(root, "claude/agents");
  const opencodeDir = join(root, "opencode/agents");
  const codexSkillDir = join(root, "agents/skills");
  const codexHome = join(root, "codex");
  const opencodeHome = join(root, "opencode");
  const kiroDir = join(root, "kiro");
  const agentsMdDir = join(root, "agents-md");
  for (const d of [home, claudeDir, opencodeDir, codexSkillDir, codexHome, opencodeHome, kiroDir, agentsMdDir]) {
    await mkdir(d, { recursive: true });
  }
  return {
    home,
    paths: {
      opencode: opencodeDir,
      "claude-code": claudeDir,
      codex: codexSkillDir,
      kiro: kiroDir,
      "agents-md": agentsMdDir,
    },
    codexHome,
    opencodeHome,
    deps: {
      agentSmithHome: home,
      paths: {
        opencode: opencodeDir,
        "claude-code": claudeDir,
        codex: codexSkillDir,
        kiro: kiroDir,
        "agents-md": agentsMdDir,
      },
      codexHome,
      opencodeHome,
    },
  };
}

async function rmTree(t: Tree): Promise<void> {
  // tmp root is parent of `home`.
  await rm(join(t.home, ".."), { recursive: true, force: true });
}

/** Seed a claude-code agent .md at the expected install path, with optional refresh hook. */
async function seedClaudeAgent(t: Tree, withHook: boolean): Promise<string> {
  const path = join(t.paths["claude-code"], `${AGENT}.md`);
  const fm: Record<string, unknown> = {
    name: AGENT,
    description: "Test agent",
  };
  if (withHook) {
    fm.hooks = {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: `smith knowledge refresh-session --agent ${AGENT} --platform claude-code`,
              statusMessage: `Refreshing ${AGENT} knowledge…`,
              timeout: 5,
            },
          ],
        },
      ],
    };
  }
  const body = "# Agent body\n";
  await writeFile(path, matter.stringify(body, fm), "utf8");
  return path;
}

/** Seed an opencode agent .md at the expected install path. */
async function seedOpencodeAgent(t: Tree): Promise<string> {
  const path = join(t.paths.opencode, `${AGENT}.md`);
  await writeFile(path, "---\nname: my-agent\n---\n\nbody\n", "utf8");
  return path;
}

/** Seed a codex agent SKILL.md at the expected install path. */
async function seedCodexAgent(t: Tree): Promise<string> {
  const dir = join(t.paths.codex, AGENT);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  await writeFile(path, "# Codex agent\n", "utf8");
  return path;
}

function manifestFixture(
  platforms: ("claude-code" | "codex" | "opencode" | "kiro")[],
): RefreshManifest {
  return {
    schemaVersion: 1,
    agent: AGENT,
    refresh_consent: {
      granted_at: "2026-05-01T00:00:00.000Z",
      platforms,
      sources: ["live-docs"],
    },
  };
}

/** Seed a kiro agent .json at the expected install path. */
async function seedKiroAgent(t: Tree): Promise<string> {
  const path = join(t.paths.kiro, `${AGENT}.json`);
  await writeFile(
    path,
    JSON.stringify({ name: AGENT, description: "Kiro agent", prompt: "x" }, null, 2),
    "utf8",
  );
  return path;
}

describe("reconfigureAgent — grant", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("grant adds platform to manifest and registers the opencode plugin entry", async () => {
    await seedClaudeAgent(t, true);
    await seedOpencodeAgent(t);
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));

    await reconfigureAgent(AGENT, { grant: ["opencode"], revoke: [] }, t.deps);

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeDefined();
    expect(m!.refresh_consent.platforms.sort()).toEqual(["claude-code", "opencode"]);

    const sentinel = await readOpencodePluginSentinel(t.opencodeHome);
    expect(sentinel).toBeDefined();
    expect(sentinel!.agents).toContain(AGENT);
  });

  test("grant for claude-code adds the refresh hook block to the agent .md frontmatter", async () => {
    await seedClaudeAgent(t, false); // installed but no hook
    await writeRefreshManifest(t.home, AGENT, manifestFixture([]));

    await reconfigureAgent(AGENT, { grant: ["claude-code"], revoke: [] }, t.deps);

    const raw = await readFile(join(t.paths["claude-code"], `${AGENT}.md`), "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const hooks = fm.hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    expect(hooks).toBeDefined();
    const command = hooks.SessionStart[0]!.hooks[0]!.command;
    expect(command).toContain(`--agent ${AGENT}`);
    expect(command).toContain("--platform claude-code");

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m!.refresh_consent.platforms).toEqual(["claude-code"]);
  });

  test("auto-creates manifest with current ISO granted_at when none exists", async () => {
    await seedOpencodeAgent(t);
    const before = Date.now();
    await reconfigureAgent(AGENT, { grant: ["opencode"], revoke: [] }, t.deps);
    const after = Date.now();

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeDefined();
    expect(m!.agent).toBe(AGENT);
    expect(m!.refresh_consent.platforms).toEqual(["opencode"]);
    expect(m!.refresh_consent.sources).toEqual([]);
    const ts = Date.parse(m!.refresh_consent.granted_at);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("idempotent — granting an already-granted platform leaves platforms[] unchanged", async () => {
    await seedClaudeAgent(t, true);
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));
    const before = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );

    await reconfigureAgent(AGENT, { grant: ["claude-code"], revoke: [] }, t.deps);

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m!.refresh_consent.platforms).toEqual(["claude-code"]);
    const after = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );
    // Idempotent grants must not rewrite the manifest. (If we did rewrite,
    // granted_at would also remain unchanged — so byte equality is the right
    // assertion here.)
    expect(after).toBe(before);
  });

  test("grant kiro succeeds when the .json file is on disk (regression: was checking .md)", async () => {
    // Pre-fix, installPathFor() returned `<name>.md` for every platform
    // except codex — including kiro. So `--grant kiro` always failed
    // with "agent is not installed for kiro" even when the JSON file
    // was sitting at ~/.kiro/agents/<name>.json. Mirrors the bug shape
    // of InstallMatrixGrid / SkillList omitting kiro from their hardcoded
    // platform arrays.
    await seedKiroAgent(t);
    await writeRefreshManifest(t.home, AGENT, manifestFixture([]));

    await reconfigureAgent(AGENT, { grant: ["kiro"], revoke: [] }, t.deps);

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeDefined();
    expect(m!.refresh_consent.platforms).toContain("kiro");
  });
});

describe("reconfigureAgent — revoke", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("revoke removes platform from manifest and strips the claude-code hooks frontmatter", async () => {
    const mdPath = await seedClaudeAgent(t, true);
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));

    await reconfigureAgent(AGENT, { grant: [], revoke: ["claude-code"] }, t.deps);

    const m = await readRefreshManifest(t.home, AGENT);
    expect(m!.refresh_consent.platforms).toEqual([]);

    const raw = await readFile(mdPath, "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    expect(fm.hooks).toBeUndefined();
    // Other frontmatter survives the surgical edit.
    expect(fm.name).toBe(AGENT);
  });

  test("revoke is idempotent — revoking a not-granted platform is a no-op", async () => {
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));
    const before = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );

    await reconfigureAgent(AGENT, { grant: [], revoke: ["opencode"] }, t.deps);

    const after = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });
});

describe("reconfigureAgent — validation", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("rejects grant when bundle has no session/always refresh sources", async () => {
    // Setup: a bundle with only install-time (non-session) refresh sources.
    await seedOpencodeAgent(t);
    await writeRefreshManifest(t.home, AGENT, manifestFixture([]));
    const bundle = {
      config: {
        schemaVersion: 1 as const,
        name: AGENT,
        targets: ["opencode" as const],
        modelTier: "balanced" as const,
        description: "Test agent",
        knowledge: {
          sources: [
            {
              id: "wiki",
              type: "url" as const,
              url: "https://example.com/wiki",
              delivery: "file" as const,
              // No refresh field means it defaults to install-time refresh, not session.
            },
          ],
        },
      },
      bundlePath: join(t.home, ".."),
      source: { kind: "user-global" as const, rootPath: join(t.home, ".."), label: "test" },
      files: { identity: "", expertise: "", soul: "", user: "" },
    };

    await expect(
      reconfigureAgent(AGENT, { grant: ["opencode"], revoke: [] }, {
        ...t.deps,
        bundle,
      }),
    ).rejects.toThrow(/no session\/always refresh sources/i);

    // Manifest unchanged (no partial side effects).
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m?.refresh_consent.platforms).toEqual([]);
  });

  test("rejects grant for a platform the agent isn't installed for, before side effects", async () => {
    // Only opencode installed. Granting claude-code should fail.
    await seedOpencodeAgent(t);
    await writeRefreshManifest(t.home, AGENT, manifestFixture([]));
    const before = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );

    await expect(
      reconfigureAgent(AGENT, { grant: ["claude-code"], revoke: [] }, t.deps),
    ).rejects.toThrow(/not installed for claude-code/);

    // Manifest unchanged (no partial side effects).
    const after = await readFile(
      join(t.home, "refresh", AGENT, "refresh-manifest.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  test("rejects overlap between grant and revoke", async () => {
    await seedOpencodeAgent(t);
    await expect(
      reconfigureAgent(AGENT, { grant: ["opencode"], revoke: ["opencode"] }, t.deps),
    ).rejects.toThrow(/both.*grant.*revoke|appears in both/i);
  });

  test("rejects invalid platform id", async () => {
    await expect(
      reconfigureAgent(AGENT, { grant: ["bogus" as never], revoke: [] }, t.deps),
    ).rejects.toThrow(/invalid platform/i);
  });

  test("empty grant + empty revoke is a no-op — does not create a manifest", async () => {
    // No manifest, no installs. Should succeed silently and create nothing.
    await reconfigureAgent(AGENT, { grant: [], revoke: [] }, t.deps);
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeUndefined();
  });

  // Defense-in-depth: reconfigureAgent builds disk paths from the agent
  // name (join(paths.codex, agent, "SKILL.md")) BEFORE the not-installed
  // check that would normally catch bogus names. Traversal sequences,
  // absolute paths, NUL bytes, backslash, hidden-dot, empty string and
  // non-kebab shapes must fail with validation-failed — NOT with the
  // usage-error "not installed for ..." that follows.
  for (const bad of ["../etc", "/abs/path", "a\0b", "a/b", "a\\b", ".hidden", "", "BadCase"]) {
    test(`rejects agent name ${JSON.stringify(bad)} with validation-failed before any IO`, async () => {
      let caught: unknown;
      try {
        await reconfigureAgent(bad, { grant: ["opencode"], revoke: [] }, t.deps);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SmithError);
      expect((caught as SmithError).payload.code).toBe("validation-failed");
    });
  }

  test("revoke-only against a never-existed manifest does not create one", async () => {
    // No manifest on disk. Revoking a not-granted platform should be a complete
    // no-op — neither the manifest nor any side-effect file appears. This
    // exercises the "auto-created manifest with no net change → don't write"
    // guard in reconfigureAgent (reachable when revoke-only is run before any
    // grant has ever happened for this agent).
    await reconfigureAgent(AGENT, { grant: [], revoke: ["opencode"] }, t.deps);
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeUndefined();
  });
});

describe("reconfigureAgent — surgical hook removal", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("revoke preserves co-resident hooks in the same SessionStart array", async () => {
    // Seed an agent .md whose `hooks.SessionStart` contains BOTH the smith
    // refresh hook AND an unrelated entry (e.g. another startup hook a user
    // or future feature added). The unrelated entry must survive the revoke
    // byte-for-byte — wholesale `delete fm.hooks` would silently nuke it.
    const path = join(t.paths["claude-code"], `${AGENT}.md`);
    const unrelatedSession = {
      matcher: "startup",
      hooks: [
        {
          type: "command",
          command: "echo hi",
          statusMessage: "Greeting",
          timeout: 1,
        },
      ],
    };
    const fm = {
      name: AGENT,
      description: "Test agent",
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [
              {
                type: "command",
                command: `smith knowledge refresh-session --agent ${AGENT} --platform claude-code`,
                statusMessage: `Refreshing ${AGENT} knowledge…`,
                timeout: 5,
              },
            ],
          },
          unrelatedSession,
        ],
      },
    };
    await writeFile(path, matter.stringify("# body\n", fm), "utf8");
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));

    await reconfigureAgent(AGENT, { grant: [], revoke: ["claude-code"] }, t.deps);

    const raw = await readFile(path, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    expect(data.name).toBe(AGENT);
    const hooks = data.hooks as { SessionStart?: unknown[] } | undefined;
    expect(hooks).toBeDefined();
    expect(Array.isArray(hooks!.SessionStart)).toBe(true);
    const ss = hooks!.SessionStart as Array<Record<string, unknown>>;
    expect(ss).toHaveLength(1);
    expect(ss[0]).toEqual(unrelatedSession);
  });

  test("revoke preserves co-resident hooks under a different event key", async () => {
    // SessionStart contains only our smith hook, but the `hooks` block also
    // has an unrelated UserPromptSubmit entry. After revoke, the
    // UserPromptSubmit block must survive AND the now-empty SessionStart
    // key must be cleaned up (not left as an empty array).
    const path = join(t.paths["claude-code"], `${AGENT}.md`);
    const userPromptSubmit = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "echo prompt",
          },
        ],
      },
    ];
    const fm = {
      name: AGENT,
      description: "Test agent",
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [
              {
                type: "command",
                command: `smith knowledge refresh-session --agent ${AGENT} --platform claude-code`,
                statusMessage: `Refreshing ${AGENT} knowledge…`,
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: userPromptSubmit,
      },
    };
    await writeFile(path, matter.stringify("# body\n", fm), "utf8");
    await writeRefreshManifest(t.home, AGENT, manifestFixture(["claude-code"]));

    await reconfigureAgent(AGENT, { grant: [], revoke: ["claude-code"] }, t.deps);

    const raw = await readFile(path, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const hooks = data.hooks as Record<string, unknown> | undefined;
    expect(hooks).toBeDefined();
    expect(hooks!.SessionStart).toBeUndefined();
    expect(hooks!.UserPromptSubmit).toEqual(userPromptSubmit);
  });
});

describe("cli/agent reconfigure — bare-invocation usage error", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("`smith agent reconfigure <name>` (no --grant/--revoke) throws SmithError(usage-error)", async () => {
    // Drive through the commander parse path so we exercise the wrap()
    // wiring end-to-end. `rethrow: true` re-throws the original SmithError
    // out of wrap()'s catch (see src/cli/wrap.ts) so we can assert on the
    // payload instead of the formatted-and-exited sentinel.
    const program = new Command().exitOverride();
    const agent = program.command("agent");
    registerAgentCommands(agent, { wrapDepsOverride: { rethrow: true } });

    const err = await program
      .parseAsync(["agent", "reconfigure", "my-agent"], { from: "user" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SmithError);
    const se = err as SmithError;
    expect(se.payload.code).toBe("usage-error");
    // Headline OR suggestedCommand should mention --grant or --revoke so the
    // user knows what to add.
    if (se.payload.code !== "usage-error") throw new Error("unreachable");
    const message = se.payload.message;
    const suggested = se.payload.suggestedCommand ?? "";
    expect(`${message} ${suggested}`).toMatch(/--grant|--revoke/);
  });
});

/**
 * v1-task B1 part 2/2: interactive flow for `agent reconfigure`.
 *
 * When the user runs `smith agent reconfigure <name>` with no
 * --grant/--revoke flags AND stdin is a TTY, the command prompts
 * per-platform (only platforms the agent is actually installed for)
 * and lets the user toggle the refresh-hook consent state. --yes
 * cascades into "grant all installed platforms" so CI can opt in
 * without prompts. Non-TTY without flags keeps the existing
 * usage-error (CI must be explicit) so behavior change is gated on
 * the TTY signal.
 */
describe("reconfigureAgent — interactive flow (v1-task B1 part 2)", () => {
  let t: Tree;
  beforeEach(async () => {
    t = await makeTree();
  });
  afterEach(async () => {
    await rmTree(t);
  });

  test("interactive: prompts once per installed platform; 'yes' answers grant", async () => {
    await seedClaudeAgent(t, false);
    await seedOpencodeAgent(t);
    // No existing manifest — fresh agent that's installed for two platforms.

    const prompts: string[] = [];
    // Platforms are prompted in PLATFORM_IDS order: opencode, claude-code, codex.
    // Only the first two are installed here.
    const answers = ["yes", "yes"];
    await reconfigureAgent(
      AGENT,
      { grant: [], revoke: [], interactive: true },
      {
        ...t.deps,
        prompt: async (msg: string) => {
          prompts.push(msg);
          return answers.shift() ?? "no";
        },
        isTTY: () => true,
      },
    );

    // Exactly one prompt per installed platform (opencode + claude-code).
    expect(prompts).toHaveLength(2);
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeDefined();
    expect(m?.refresh_consent.platforms.sort()).toEqual(["claude-code", "opencode"]);
  });

  test("interactive: 'no' answer for a platform leaves it unregistered", async () => {
    await seedClaudeAgent(t, false);
    await seedOpencodeAgent(t);

    // PLATFORM_IDS order: opencode first, then claude-code. Answer "no"
    // to opencode and "yes" to claude-code.
    const answers = ["no", "yes"];
    await reconfigureAgent(
      AGENT,
      { grant: [], revoke: [], interactive: true },
      {
        ...t.deps,
        prompt: async () => answers.shift() ?? "no",
        isTTY: () => true,
      },
    );

    const m = await readRefreshManifest(t.home, AGENT);
    // opencode declined, claude-code granted → only claude-code present.
    expect(m).toBeDefined();
    expect(m?.refresh_consent.platforms).toEqual(["claude-code"]);
  });

  test("interactive: all 'no' answers do not auto-create an empty manifest", async () => {
    await seedClaudeAgent(t, false);
    await seedOpencodeAgent(t);

    await reconfigureAgent(
      AGENT,
      { grant: [], revoke: [], interactive: true },
      {
        ...t.deps,
        prompt: async () => "no",
        isTTY: () => true,
      },
    );

    // Matches the existing no-op invariant (line ~184 in reconfigure.ts).
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m).toBeUndefined();
  });

  test("interactive: skips platforms the agent isn't installed for", async () => {
    // Only claude-code installed; opencode + codex not installed.
    await seedClaudeAgent(t, false);

    const prompts: string[] = [];
    await reconfigureAgent(
      AGENT,
      { grant: [], revoke: [], interactive: true },
      {
        ...t.deps,
        prompt: async (msg: string) => {
          prompts.push(msg);
          return "yes";
        },
        isTTY: () => true,
      },
    );

    // Only ONE prompt — for claude-code, the only installed platform.
    expect(prompts).toHaveLength(1);
    const m = await readRefreshManifest(t.home, AGENT);
    expect(m?.refresh_consent.platforms).toEqual(["claude-code"]);
  });

  test("interactive + non-TTY: throws usage-error (no silent default)", async () => {
    await seedClaudeAgent(t, false);

    let caught: unknown;
    try {
      await reconfigureAgent(
        AGENT,
        { grant: [], revoke: [], interactive: true },
        {
          ...t.deps,
          isTTY: () => false,
          // No prompt provided — but the non-TTY branch must short-circuit
          // before any prompt call, so this should error not hang.
        },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const se = caught as SmithError;
    expect(se.payload.code).toBe("usage-error");
    if (se.payload.code !== "usage-error") throw new Error("unreachable");
    expect(se.payload.message).toMatch(/--grant|--revoke|--yes/);
  });
});
