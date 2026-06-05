import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAgent } from "../../src/cli/commands/init-agent";
import { expandPreset } from "../../src/core/permission-presets";
import { SmithError } from "../../src/core/smith-error";

let tmp: string;
let agentsDir: string;
let userPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-initagent-"));
  agentsDir = join(tmp, "agents");
  userPath = join(tmp, "USER.md");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(userPath, "# About me\nYou note things.\n");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("cli/init-agent", () => {
  // Defense-in-depth: name and `paths.from` flow into join() / mkdir() /
  // readFile() before the registry is consulted. Both must be rejected as
  // validation-failed (not as not-found / already-exists / schema errors).
  for (const bad of ["../etc", "/abs/path", "a\0b", "a/b", "a\\b", ".hidden", "", "BadCase"]) {
    test(`rejects agent name ${JSON.stringify(bad)} with validation-failed before any IO`, async () => {
      let caught: unknown;
      try {
        await initAgent(
          bad,
          { description: "Reviews code carefully" },
          { agentsDir, canonicalUserPath: userPath },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SmithError);
      expect((caught as SmithError).payload.code).toBe("validation-failed");
    });
    test(`rejects --from source ${JSON.stringify(bad)} with validation-failed before any IO`, async () => {
      let caught: unknown;
      try {
        await initAgent("clone", {}, { agentsDir, canonicalUserPath: userPath, from: bad });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      expect(payload.code).toBe("validation-failed");
      // Distinguish from the name-validation branch: the `what` field must
      // mention the --from label so we know the second guard fired, not the
      // first. Without this, a future refactor that swapped guard order
      // would still pass this test silently.
      if (payload.code === "validation-failed") {
        expect(payload.what).toContain("--from source");
      }
    });
  }

  test("scaffolds a new bundle from flags", async () => {
    const code = await initAgent(
      "code-reviewer",
      {
        description: "Reviews code",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    expect(code).toBe(0);
    const dir = join(agentsDir, "code-reviewer");
    const cfg = JSON.parse(await readFile(join(dir, "agent.config.json"), "utf8"));
    expect(cfg.name).toBe("code-reviewer");
    expect(cfg.description).toBe("Reviews code");
    expect(cfg.targets).toEqual(["opencode"]);
    expect(cfg.modelTier).toBe("balanced");

    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md"]) {
      const content = await readFile(join(dir, f), "utf8");
      expect(content).toContain("TODO");
    }

    const userStat = await lstat(join(dir, "USER.md"));
    expect(userStat.isSymbolicLink()).toBe(true);
  });

  test("refuses to overwrite existing bundle", async () => {
    await mkdir(join(agentsDir, "exists"), { recursive: true });
    const err = await initAgent(
      "exists",
      {
        description: "Test agent for overwrite check",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("already-exists");
    expect(err.payload.what).toBe("agent");
    expect(err.payload.identifier).toBe("exists");
  });

  test("clones an existing bundle with --from", async () => {
    await initAgent(
      "source",
      {
        description: "Original agent",
        targets: ["opencode", "claude-code"],
        modelTier: "balanced",
        mode: "subagent",
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    await writeFile(join(agentsDir, "source", "IDENTITY.md"), "You are a senior reviewer.\n");
    await writeFile(join(agentsDir, "source", "EXPERTISE.md"), "You spot N+1.\n");
    await writeFile(join(agentsDir, "source", "SOUL.md"), "You speak tersely.\n");

    const code = await initAgent(
      "clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "source",
      },
    );
    expect(code).toBe(0);

    const cloneDir = join(agentsDir, "clone");
    const cfg = JSON.parse(await readFile(join(cloneDir, "agent.config.json"), "utf8"));
    expect(cfg.name).toBe("clone");
    expect(cfg.description).toBe("Original agent");
    expect(cfg.targets).toEqual(["opencode", "claude-code"]);
    expect(cfg.mode).toBe("subagent");

    expect(await readFile(join(cloneDir, "IDENTITY.md"), "utf8")).toBe(
      "You are a senior reviewer.\n",
    );
    expect(await readFile(join(cloneDir, "EXPERTISE.md"), "utf8")).toBe("You spot N+1.\n");
    expect(await readFile(join(cloneDir, "SOUL.md"), "utf8")).toBe("You speak tersely.\n");

    const userStat = await lstat(join(cloneDir, "USER.md"));
    expect(userStat.isSymbolicLink()).toBe(true);
  });

  test("clone with --from raises not-found when source agent.config.json is missing", async () => {
    // Create the bundle dir (so --from finds it) but omit agent.config.json.
    const srcDir = join(agentsDir, "src-agent");
    await mkdir(srcDir, { recursive: true });

    const err = await initAgent(
      "new-agent",
      { description: "Reviews source bundle clone behaviour" },
      { agentsDir, canonicalUserPath: userPath, from: "src-agent" },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    const payload = (err as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("source agent config");
      expect(payload.identifier).toContain("agent.config.json");
    }
  });

  test("clone with --from raises validation-failed for malformed source agent.config.json", async () => {
    const srcDir = join(agentsDir, "src-agent");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "agent.config.json"), "{not json");

    const err = await initAgent(
      "new-agent",
      { description: "Reviews source bundle clone behaviour" },
      { agentsDir, canonicalUserPath: userPath, from: "src-agent" },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    const payload = (err as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("source agent config");
      expect(payload.reasons.some((r) => r.includes("malformed JSON"))).toBe(true);
    }
  });

  test.skipIf(process.getuid?.() === 0)(
    "clone with --from raises permission-denied when source agent.config.json is unreadable",
    async () => {
      const srcDir = join(agentsDir, "src-agent");
      await mkdir(srcDir, { recursive: true });
      const cfgPath = join(srcDir, "agent.config.json");
      await writeFile(cfgPath, "{}");
      await writeFile(join(srcDir, "IDENTITY.md"), "# id\n");
      await writeFile(join(srcDir, "EXPERTISE.md"), "# ex\n");
      await writeFile(join(srcDir, "SOUL.md"), "# so\n");
      await chmod(cfgPath, 0o000);

      try {
        const err = await initAgent(
          "new-agent",
          { description: "Reviews source bundle clone behaviour" },
          { agentsDir, canonicalUserPath: userPath, from: "src-agent" },
        ).catch((e) => e);

        expect(err).toBeInstanceOf(SmithError);
        const payload = (err as SmithError).payload;
        expect(payload.code).toBe("permission-denied");
        if (payload.code === "permission-denied") {
          expect(payload.path).toContain("agent.config.json");
          expect(payload.operation).toBe("read");
        }
      } finally {
        // best-effort: afterEach rm -rf may have already removed cfgPath
        await chmod(cfgPath, 0o644).catch(() => {});
      }
    },
  );

  test("clone with --from refuses if source does not exist", async () => {
    const err = await initAgent(
      "clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "nonexistent",
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("source agent");
    expect(err.payload.identifier).toBe("nonexistent");
  });

  test("clone with --from applies overrides to config", async () => {
    await initAgent(
      "source",
      {
        description: "Reviews original code carefully",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    const code = await initAgent(
      "clone",
      {
        description: "Reviews overridden things now",
        modelTier: "fast",
      },
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "source",
      },
    );
    expect(code).toBe(0);

    const cfg = JSON.parse(await readFile(join(agentsDir, "clone", "agent.config.json"), "utf8"));
    expect(cfg.description).toBe("Reviews overridden things now");
    expect(cfg.modelTier).toBe("fast");
    expect(cfg.targets).toEqual(["opencode"]);
  });

  test("rejects --description shorter than schema minimum and writes nothing", async () => {
    const err = await initAgent(
      "too-short",
      {
        description: "short",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("--description");
    expect(err.payload.reasons.length).toBeGreaterThan(0);
    let exists = false;
    try {
      await stat(join(agentsDir, "too-short"));
      exists = true;
    } catch {
      // expected
    }
    expect(exists).toBe(false);
  });

  test("clone with --from preserves source permission when no override", async () => {
    await initAgent(
      "source",
      {
        description: "With permission configured",
        targets: ["opencode"],
        modelTier: "balanced",
        permission: { read: "allow" },
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    const code = await initAgent(
      "clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "source",
      },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(agentsDir, "clone", "agent.config.json"), "utf8"));
    expect(cfg.permission).toEqual({ read: "allow" });
  });

  test("clone with --from + --permission overrides source permission entirely", async () => {
    await initAgent(
      "source",
      {
        description: "With read-only permission",
        targets: ["opencode"],
        modelTier: "balanced",
        permission: expandPreset("read-only"),
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    const code = await initAgent(
      "clone",
      {
        permission: expandPreset("full"),
      },
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "source",
      },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(agentsDir, "clone", "agent.config.json"), "utf8"));
    expect(cfg.permission.bash).toBe("allow"); // from "full", not "read-only"'s "deny"
    expect(cfg.permission).toEqual(expandPreset("full"));
  });

  test("scaffold with --permission read-only writes structured permission to disk", async () => {
    const code = await initAgent(
      "perm-readonly",
      {
        description: "Reviews code carefully",
        targets: ["opencode"],
        modelTier: "balanced",
        permission: expandPreset("read-only"),
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "perm-readonly", "agent.config.json"), "utf8"),
    );
    expect(cfg.permission).toEqual(expandPreset("read-only"));
    expect(cfg.tools).toBeUndefined();
    expect("tools" in cfg).toBe(false);
  });

  // CLI JSON parsing tested manually; this test covers the post-parse contract.
  test("scaffold with --permission-json passes custom permission verbatim", async () => {
    const code = await initAgent(
      "perm-custom",
      {
        description: "Reviews code with custom permissions",
        targets: ["opencode"],
        modelTier: "balanced",
        permission: { read: "allow", bash: "deny" },
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "perm-custom", "agent.config.json"), "utf8"),
    );
    expect(cfg.permission.read).toBe("allow");
    expect(cfg.permission.bash).toBe("deny");
  });

  test("clone with --from falls back to examplesDir when source absent from agentsDir", async () => {
    // Set up an examples directory containing a "ship-example" bundle.
    const examplesDir = join(tmp, "examples");
    const shipDir = join(examplesDir, "ship-example");
    await mkdir(shipDir, { recursive: true });
    await writeFile(
      join(shipDir, "agent.config.json"),
      JSON.stringify(
        {
          name: "ship-example",
          description: "Ships as an example bundle",
          targets: ["opencode"],
          modelTier: "balanced",
          mode: "subagent",
        },
        null,
        2,
      ),
    );
    await writeFile(join(shipDir, "IDENTITY.md"), "You are an example.\n");
    await writeFile(join(shipDir, "EXPERTISE.md"), "You demonstrate things.\n");
    await writeFile(join(shipDir, "SOUL.md"), "You speak in examples.\n");

    // The source name does NOT exist in agentsDir; only in examplesDir.
    const code = await initAgent(
      "my-clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "ship-example",
        examplesDir,
      },
    );
    expect(code).toBe(0);

    const cloneDir = join(agentsDir, "my-clone");
    const cfg = JSON.parse(await readFile(join(cloneDir, "agent.config.json"), "utf8"));
    expect(cfg.name).toBe("my-clone");
    expect(cfg.description).toBe("Ships as an example bundle");
    expect(cfg.mode).toBe("subagent");
    expect(await readFile(join(cloneDir, "IDENTITY.md"), "utf8")).toBe("You are an example.\n");
    expect(await readFile(join(cloneDir, "EXPERTISE.md"), "utf8")).toBe(
      "You demonstrate things.\n",
    );
    expect(await readFile(join(cloneDir, "SOUL.md"), "utf8")).toBe("You speak in examples.\n");
  });

  test("clone with --from prefers agentsDir over examplesDir when both contain the source", async () => {
    // Same name in both locations; agentsDir wins (user's local copy is authoritative).
    const examplesDir = join(tmp, "examples");
    const shipDir = join(examplesDir, "shared-name");
    await mkdir(shipDir, { recursive: true });
    await writeFile(
      join(shipDir, "agent.config.json"),
      JSON.stringify(
        {
          name: "shared-name",
          description: "From the examples directory",
          targets: ["opencode"],
          modelTier: "balanced",
        },
        null,
        2,
      ),
    );
    await writeFile(join(shipDir, "IDENTITY.md"), "You are the example version.\n");
    await writeFile(join(shipDir, "EXPERTISE.md"), "You are shipped.\n");
    await writeFile(join(shipDir, "SOUL.md"), "You demonstrate things.\n");

    // Local agentsDir copy with different content.
    const localDir = join(agentsDir, "shared-name");
    await mkdir(localDir, { recursive: true });
    await writeFile(
      join(localDir, "agent.config.json"),
      JSON.stringify(
        {
          name: "shared-name",
          description: "From the user's local agents directory",
          targets: ["opencode"],
          modelTier: "fast",
        },
        null,
        2,
      ),
    );
    await writeFile(join(localDir, "IDENTITY.md"), "You are the local version.\n");
    await writeFile(join(localDir, "EXPERTISE.md"), "You are user-edited.\n");
    await writeFile(join(localDir, "SOUL.md"), "You speak as the user wrote you.\n");

    const code = await initAgent(
      "my-clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "shared-name",
        examplesDir,
      },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "my-clone", "agent.config.json"), "utf8"),
    );
    expect(cfg.description).toBe("From the user's local agents directory");
    expect(cfg.modelTier).toBe("fast");
    expect(await readFile(join(agentsDir, "my-clone", "IDENTITY.md"), "utf8")).toBe(
      "You are the local version.\n",
    );
  });

  test("clone with --from fails when source absent from both agentsDir and examplesDir", async () => {
    const examplesDir = join(tmp, "examples");
    await mkdir(examplesDir, { recursive: true });

    const err = await initAgent(
      "my-clone",
      {},
      {
        agentsDir,
        canonicalUserPath: userPath,
        from: "no-such-source",
        examplesDir,
      },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
    expect(err.payload.what).toBe("source agent");
    expect(err.payload.identifier).toBe("no-such-source");
    // The reasons (or message context) should mention both search paths.
    const detail = JSON.stringify(err.payload);
    expect(detail).toContain(agentsDir);
    expect(detail).toContain(examplesDir);
  });

  test("scaffold without permission omits permission key entirely", async () => {
    const code = await initAgent(
      "no-perm",
      {
        description: "No permission configured at all",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(await readFile(join(agentsDir, "no-perm", "agent.config.json"), "utf8"));
    expect("permission" in cfg).toBe(false);
    expect("tools" in cfg).toBe(false);
  });

  test("writes requires.skills to agent.config.json when provided", async () => {
    const code = await initAgent(
      "team-helper",
      {
        description: "Use proactively to query Atlassian via team skills.",
        targets: ["opencode"],
        modelTier: "balanced",
        requiresSkills: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "team-helper/agent.config.json"), "utf8"),
    );
    expect(cfg.requires).toEqual({
      skills: [{ catalog: "team", name: "jira-helper" }, { name: "confluence-helper" }],
    });
  });

  test("omits requires entirely when requiresSkills is not passed", async () => {
    const code = await initAgent(
      "plain-agent",
      {
        description: "Use proactively for plain tasks without skills.",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "plain-agent/agent.config.json"), "utf8"),
    );
    expect(Object.hasOwn(cfg, "requires")).toBe(false);
  });

  test("writes a stub USER.md (not symlink) when catalogKind is 'registered'", async () => {
    const code = await initAgent(
      "team-agent",
      {
        description: "Use proactively for team-shared scaffolding tasks",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath, catalogKind: "registered" },
    );

    expect(code).toBe(0);
    const userMdPath = join(agentsDir, "team-agent", "USER.md");
    const stat = await lstat(userMdPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
    const content = await readFile(userMdPath, "utf8");
    expect(content).toContain("placeholder");
    expect(content).toContain("symlink");
  });

  test("preserves symlink USER.md when catalogKind is 'user-global'", async () => {
    const code = await initAgent(
      "personal-agent",
      {
        description: "Use proactively for personal scaffolding tasks",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath, catalogKind: "user-global" },
    );

    expect(code).toBe(0);
    const stat = await lstat(join(agentsDir, "personal-agent", "USER.md"));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  test("preserves symlink USER.md when catalogKind is 'project'", async () => {
    const code = await initAgent(
      "project-agent",
      {
        description: "Use proactively for project-scoped scaffolding tasks",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath, catalogKind: "project" },
    );

    expect(code).toBe(0);
    const stat = await lstat(join(agentsDir, "project-agent", "USER.md"));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  test("does not warn about missing canonical USER when catalogKind is 'registered'", async () => {
    // Registered catalogs write a stub USER.md, so the canonical path is
    // irrelevant — the "Run `smith init`" warning would be noise.
    await rm(userPath, { force: true });
    const warnings: string[] = [];
    const code = await initAgent(
      "team-agent-no-canonical",
      {
        description: "Use proactively for team-shared scaffolding tasks",
        targets: ["opencode"],
        modelTier: "balanced",
        printErr: (m) => warnings.push(m),
      },
      { agentsDir, canonicalUserPath: userPath, catalogKind: "registered" },
    );

    expect(code).toBe(0);
    expect(warnings.some((w) => w.includes("does not exist"))).toBe(false);
  });

  test("defaults to symlink USER.md when catalogKind is unspecified (backwards compat)", async () => {
    const code = await initAgent(
      "default-agent",
      {
        description: "Use proactively when catalogKind is unspecified",
        targets: ["opencode"],
        modelTier: "balanced",
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    expect(code).toBe(0);
    const stat = await lstat(join(agentsDir, "default-agent", "USER.md"));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  test("defaults targets to detected platforms + agents-md when --targets is omitted", async () => {
    // Inject a known detection set so the test does not depend on what
    // CLIs happen to be on the host PATH. The default-target path runs
    // only when the caller omits `--targets` AND the source config (if
    // any) does not declare `targets` — this scaffolds a fresh bundle
    // with no source so the detection result drives the field directly.
    const code = await initAgent(
      "detected-defaults",
      {
        description: "Use proactively to verify default-target detection",
        modelTier: "balanced",
        detectInstalledPlatforms: async () => new Set(["claude-code", "kiro"]),
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "detected-defaults", "agent.config.json"), "utf8"),
    );
    expect(cfg.targets).toEqual(["claude-code", "kiro", "agents-md"]);
  });

  test("defaults targets to [agents-md] when zero platforms are detected", async () => {
    const code = await initAgent(
      "no-platforms",
      {
        description: "Use proactively to verify zero-detection fallback",
        modelTier: "balanced",
        detectInstalledPlatforms: async () => new Set(),
      },
      { agentsDir, canonicalUserPath: userPath },
    );
    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(agentsDir, "no-platforms", "agent.config.json"), "utf8"),
    );
    expect(cfg.targets).toEqual(["agents-md"]);
  });

  test("self-bootstraps canonical USER.md when missing on fresh state", async () => {
    // rc.3 contract: smith agent init on truly-fresh state (no
    // canonical USER.md) must create the canonical file with the
    // standard template before symlinking the bundle's USER.md to it.
    // This eliminates the rc.2 broken-symlink edge case.
    await rm(userPath, { force: true });
    const messages: string[] = [];
    const code = await initAgent(
      "fresh-bot",
      {
        description: "Use proactively for fresh-state validation",
        targets: ["opencode"],
        modelTier: "balanced",
        print: (m) => messages.push(m),
      },
      { agentsDir, canonicalUserPath: userPath },
    );

    expect(code).toBe(0);
    // Canonical USER.md was created with the standard template.
    const canonicalContent = await readFile(userPath, "utf8");
    expect(canonicalContent).toContain("# About me");
    expect(canonicalContent).toContain("Replace this with context");
    // The bundle's USER.md is a valid (non-broken) symlink.
    const linkStat = await lstat(join(agentsDir, "fresh-bot", "USER.md"));
    expect(linkStat.isSymbolicLink()).toBe(true);
    const targetContent = await readFile(join(agentsDir, "fresh-bot", "USER.md"), "utf8");
    expect(targetContent).toContain("# About me");
    // Info message was emitted (replaces the rc.2 warning).
    expect(messages.some((m) => m.includes("Seeded canonical USER.md"))).toBe(true);
  });
});
