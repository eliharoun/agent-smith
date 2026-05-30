// CLI wiring test for: smith skill install/update/uninstall.
//
// We mount the subcommands on a fresh Commander program with --homeDirOverride
// so the state file, registry file, AND default per-platform skill dirs all
// land inside a temp $HOME. End-to-end behavior is exercised through the
// installer (no mocking of fs).

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSkillInstallCommands } from "../../src/cli/commands/skill/install-cmd";
import { loadSkillRegistry } from "../../src/io/skill-registry";

let home: string;
let catalogDir: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-skill-install-cli-"));
  catalogDir = await mkdtemp(join(tmpdir(), "smith-cat-"));
  // Pre-create the platform skill dirs so installer copies into them.
  await mkdir(join(home, ".config/opencode/skills"), { recursive: true });
  await mkdir(join(home, ".claude/skills"), { recursive: true });
  await mkdir(join(home, ".agents/skills"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(catalogDir, { recursive: true, force: true });
});

async function makeSkill(name: string, body = "", parent?: string): Promise<string> {
  const dir = join(parent ?? catalogDir, name);
  await mkdir(dir, { recursive: true });
  // Real skills have YAML frontmatter; resolveAdHocSource requires it.
  const fm = `---\nname: ${name}\ndescription: test skill\n---\n`;
  await writeFile(join(dir, "SKILL.md"), `${fm}${body || `# ${name}\n`}`);
  return dir;
}

function buildProgram(): Command {
  // Silence Commander's process.exit on errors; surface them as throws so
  // tests can assert on exitCode set by our action handlers instead.
  const program = new Command().exitOverride();
  const skill = program.command("skill");
  // `rethrow: true` is wrap()'s test mode (see src/cli/wrap.ts): on action
  // success, wrap() does nothing (default would call process.exit, killing
  // the bun-test runner); on action failure, wrap() re-throws the original
  // error so `parseAsync(...).catch(e => e)` sees the SmithError instead of
  // the formatted-and-printed sentinel handleThrow throws after exit.
  registerSkillInstallCommands(skill, {
    homeDirOverride: home,
    wrapDepsOverride: { rethrow: true },
  });
  return program;
}

describe("cli/skill install (D2)", () => {
  test("--from <path> auto-registers an adhoc catalog and installs the skill", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("ad-hoc-one");

    await buildProgram().parseAsync(["skill", "install", "--from", skillPath], { from: "user" });

    // Skill copied to all three platform dirs.
    for (const sub of [".config/opencode/skills", ".claude/skills", ".agents/skills"]) {
      const dest = join(home, sub, "ad-hoc-one");
      const s = await stat(dest);
      expect(s.isDirectory()).toBe(true);
      expect(s.isSymbolicLink()).toBe(false);
      const md = await readFile(join(dest, "SKILL.md"), "utf8");
      expect(md).toContain("name: ad-hoc-one");
    }
    // Catalog registered (synthetic adhoc label). For a single-skill install
    // the catalog rootPath is the skill's parent directory.
    const reg = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    expect(reg.catalogs.some((c) => c.rootPath === catalogDir)).toBe(true);
    // State file records the install.
    const state = JSON.parse(
      await readFile(join(home, ".config/agent-smith/installed-skills.json"), "utf8"),
    );
    expect(state.installed).toHaveLength(1);
    expect(state.installed[0].name).toBe("ad-hoc-one");
  });

  test("--from with --as honored as the catalog label", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("named-one");

    await buildProgram().parseAsync(["skill", "install", "--from", skillPath, "--as", "my-label"], {
      from: "user",
    });

    const reg = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    expect(reg.catalogs.some((c) => c.label === "my-label")).toBe(true);
  });

  test("--from with --as <label> rejects when same label is used across two different parent dirs", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    // Two skills in two SEPARATE parent dirs, both installed with --as
    // "shared" — this still collides because addCatalog rejects a label
    // already used by a different rootPath.
    const a = await makeSkill("first");
    const otherCatalogDir = await mkdtemp(join(tmpdir(), "smith-cat-other-"));
    try {
      const b = await makeSkill("second", "", otherCatalogDir);
      await buildProgram().parseAsync(["skill", "install", "--from", a, "--as", "shared"], {
        from: "user",
      });
      const prog = buildProgram();
      const err = await prog
        .parseAsync(["skill", "install", "--from", b, "--as", "shared"], {
          from: "user",
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/--as|already|skill catalog/i);
    } finally {
      await rm(otherCatalogDir, { recursive: true, force: true });
    }
  });

  test("--targets opencode installs to opencode only", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("oc-only");

    await buildProgram().parseAsync(
      ["skill", "install", "--from", skillPath, "--targets", "opencode"],
      { from: "user" },
    );

    await stat(join(home, ".config/opencode/skills/oc-only")); // exists
    await expect(stat(join(home, ".claude/skills/oc-only"))).rejects.toThrow();
    await expect(stat(join(home, ".agents/skills/oc-only"))).rejects.toThrow();
  });

  test("rejects already-installed skill on second install", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("dup");
    await buildProgram().parseAsync(["skill", "install", "--from", skillPath], { from: "user" });
    const err = await buildProgram()
      .parseAsync(["skill", "install", "--from", skillPath, "--as", "alt"], {
        from: "user",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.reasons.join(" ")).toMatch(/already installed|installed/i);
  });
});

describe("cli/skill install: default label + collision warning (D2)", () => {
  test("--from <path> default label is derived from parent dir, not skill name", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("first");
    await buildProgram().parseAsync(["skill", "install", "--from", skillPath], { from: "user" });
    const reg = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    const adhoc = reg.catalogs.find((c) => c.adhoc);
    expect(adhoc).toBeDefined();
    expect(adhoc!.label).not.toBe("first");
    const { deriveDefaultCatalogLabel } = await import("../../src/io/catalog-label");
    expect(adhoc!.label).toBe(deriveDefaultCatalogLabel(catalogDir));
  });

  test("second --from from same parent dir warns on stderr and keeps existing label", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const stderrLines: string[] = [];
    const errSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });

    const a = await makeSkill("alpha");
    const b = await makeSkill("beta");

    // First install pins an explicit label so the second install's derived
    // default differs from what's already registered. That's the scenario
    // worth warning about (silent merge under a mismatched label).
    await buildProgram().parseAsync(["skill", "install", "--from", a, "--as", "pinned-label"], {
      from: "user",
    });
    const reg1 = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    const initialLabel = reg1.catalogs.find((c) => c.adhoc)!.label;
    expect(initialLabel).toBe("pinned-label");

    await buildProgram().parseAsync(["skill", "install", "--from", b], { from: "user" });

    expect(stderrLines.some((l) => /already registered/i.test(l))).toBe(true);

    const reg2 = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    const adhocs = reg2.catalogs.filter((c) => c.adhoc);
    expect(adhocs).toHaveLength(1);
    expect(adhocs[0]!.label).toBe(initialLabel);

    errSpy.mockRestore();
  });

  test("--from with --as on a fresh path: no warning, label honored", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const stderrLines: string[] = [];
    const errSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });

    const skillPath = await makeSkill("explicit");
    await buildProgram().parseAsync(
      ["skill", "install", "--from", skillPath, "--as", "explicit-label"],
      { from: "user" },
    );

    const reg = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    expect(reg.catalogs.find((c) => c.label === "explicit-label")).toBeDefined();
    expect(stderrLines.some((l) => /already registered/i.test(l))).toBe(false);

    errSpy.mockRestore();
  });
});

describe("cli/skill install: failed install does NOT persist adhoc catalog", () => {
  test("when install fails (no writable platforms), the new adhoc catalog is not saved to skill-catalogs.json", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});
    const skillPath = await makeSkill("phantom");
    // Remove ALL platform skill dirs that beforeEach created — with none
    // present, copyToPlatforms writes nothing and installSkill returns
    // { ok: false, error: "install failed: no platforms written" }.
    await rm(join(home, ".config/opencode/skills"), { recursive: true, force: true });
    await rm(join(home, ".claude/skills"), { recursive: true, force: true });
    await rm(join(home, ".agents/skills"), { recursive: true, force: true });

    const err = await buildProgram()
      .parseAsync(["skill", "install", "--from", skillPath], { from: "user" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.reasons.join(" ")).toMatch(/no platforms written/);

    // Critical assertion: the failed install must not have persisted a
    // phantom catalog. Either the registry file doesn't exist, or it does
    // but contains no catalog for our skill's parent dir.
    const regPath = join(home, ".config/agent-smith/skill-catalogs.json");
    const fileExists = await stat(regPath)
      .then(() => true)
      .catch(() => false);
    if (fileExists) {
      const reg = await loadSkillRegistry(regPath);
      expect(reg.catalogs.some((c) => c.rootPath === catalogDir)).toBe(false);
    }
  });
});

describe("cli/skill update (D2)", () => {
  test("re-copies and refreshes hash after source edit", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("u1", "# u1 v1\n");
    await buildProgram().parseAsync(["skill", "install", "--from", skillPath], { from: "user" });
    // Edit source — keep frontmatter intact, change body.
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: u1\ndescription: test skill\n---\n# u1 v2\n",
    );
    await buildProgram().parseAsync(["skill", "update", "u1"], { from: "user" });
    const md = await readFile(join(home, ".config/opencode/skills/u1/SKILL.md"), "utf8");
    expect(md).toContain("# u1 v2");
  });

  test("--all updates every installed skill", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const a = await makeSkill("aa", "# aa v1\n");
    const b = await makeSkill("bb", "# bb v1\n");
    await buildProgram().parseAsync(["skill", "install", "--from", a], { from: "user" });
    await buildProgram().parseAsync(["skill", "install", "--from", b], { from: "user" });
    await writeFile(join(a, "SKILL.md"), "---\nname: aa\ndescription: test skill\n---\n# aa v2\n");
    await writeFile(join(b, "SKILL.md"), "---\nname: bb\ndescription: test skill\n---\n# bb v2\n");
    await buildProgram().parseAsync(["skill", "update", "--all"], { from: "user" });
    expect(await readFile(join(home, ".config/opencode/skills/aa/SKILL.md"), "utf8")).toContain(
      "# aa v2",
    );
    expect(await readFile(join(home, ".config/opencode/skills/bb/SKILL.md"), "utf8")).toContain(
      "# bb v2",
    );
  });
});

describe("cli/skill uninstall (D2)", () => {
  test("removes copies, drops state entry, auto-unregisters adhoc catalog", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("gone");
    await buildProgram().parseAsync(["skill", "install", "--from", skillPath, "--as", "gone-cat"], {
      from: "user",
    });

    await buildProgram().parseAsync(["skill", "uninstall", "gone"], { from: "user" });

    await expect(stat(join(home, ".config/opencode/skills/gone"))).rejects.toThrow();
    const state = JSON.parse(
      await readFile(join(home, ".config/agent-smith/installed-skills.json"), "utf8"),
    );
    expect(state.installed).toEqual([]);
    const reg = await loadSkillRegistry(join(home, ".config/agent-smith/skill-catalogs.json"));
    expect(reg.catalogs.some((c) => c.label === "gone-cat")).toBe(false);
  });
});

describe("cli/skill install: --from supports ~ expansion", () => {
  test("~/<rel> is expanded against process homedir(): rejects non-existent path", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    // We don't have a writable shim for homedir() inside this test, but we
    // CAN verify the expansion happens by feeding a path that would only
    // resolve via expansion. The error path then proves the prefix was
    // stripped (otherwise the literal '~/...' would have produced a
    // different error message about a missing local path).
    const err = await buildProgram()
      .parseAsync(["skill", "install", "--from", "~/nope-this-does-not-exist-xyz"], {
        from: "user",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    // Error must reference the EXPANDED path, never the literal ~/.
    expect(msg).not.toMatch(/~\//);
    expect(msg).toMatch(/nope-this-does-not-exist-xyz/);
  });
});

describe("cli/skill install: name validation (path-traversal)", () => {
  test("rejects '../escape' as <ref>", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const err = await buildProgram()
      .parseAsync(["skill", "install", "../escape"], { from: "user" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.reasons.join(" ")).toMatch(/invalid skill name/i);
  });
});

describe("cli/skill install: typed SmithError payloads", () => {
  test("--targets with unknown platform throws usage-error SmithError", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const skillPath = await makeSkill("ad-hoc-targets");
    const err = await buildProgram()
      .parseAsync(["skill", "install", "--from", skillPath, "--targets", "opencode,bogus"], {
        from: "user",
      })
      .catch((e) => e);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("usage-error");
    expect(err.payload.message).toMatch(/bogus/);
  });

  test("install with no <ref> and no --from throws usage-error SmithError", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const err = await buildProgram()
      .parseAsync(["skill", "install"], { from: "user" })
      .catch((e) => e);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("usage-error");
  });

  test("install with absolute path as <ref> throws usage-error SmithError", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const err = await buildProgram()
      .parseAsync(["skill", "install", "/abs/path"], { from: "user" })
      .catch((e) => e);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("usage-error");
    expect(err.payload.suggestedCommand).toMatch(/--from/);
  });

  test("install with traversal '../x' throws validation-failed SmithError", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const err = await buildProgram()
      .parseAsync(["skill", "install", "../escape"], { from: "user" })
      .catch((e) => e);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("validation-failed");
    expect(err.payload.what).toBe("skill name");
  });

  test("update without name and without --all throws usage-error SmithError", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const err = await buildProgram()
      .parseAsync(["skill", "update"], { from: "user" })
      .catch((e) => e);
    const { SmithError } = await import("../../src/core/smith-error");
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("usage-error");
  });
});

describe("cli/skill install: Python-missing refusal for atlassian-skills", () => {
  test("refuses install of atlassian-skills/<bundle> when Python is not on PATH", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    // Mock detectPython to return no binary.
    const pythonMod = await import("../../src/io/python-runtime");
    const spy = spyOn(pythonMod, "detectPython").mockResolvedValue({
      binary: null,
      version: null,
      versionOk: false,
      packagesAvailable: { requests: false, dotenv: false },
    });

    // Register a fake atlassian-skills catalog with a skill in it.
    const catDir = await mkdtemp(join(tmpdir(), "smith-atlassian-skills-"));
    try {
      await mkdir(join(catDir, "atlassian-readonly-skills"), { recursive: true });
      await writeFile(
        join(catDir, "atlassian-readonly-skills", "SKILL.md"),
        "---\nname: atlassian-readonly-skills\ndescription: test\n---\n# test\n",
      );
      const { saveSkillRegistry } = await import("../../src/io/skill-registry");
      const regPath = join(home, ".config/agent-smith/skill-catalogs.json");
      await saveSkillRegistry(regPath, {
        schemaVersion: 2,
        catalogs: [
          { kind: "team-shared", label: "atlassian-skills", rootPath: catDir, protected: true },
        ],
      });

      const err = await buildProgram()
        .parseAsync(["skill", "install", "atlassian-skills/atlassian-readonly-skills"], {
          from: "user",
        })
        .catch((e) => e);

      const { SmithError } = await import("../../src/core/smith-error");
      expect(err).toBeInstanceOf(SmithError);
      expect(err.payload.code).toBe("usage-error");
      expect(err.payload.message).toContain("python.org");
      expect(err.payload.message).toContain("3.8");
    } finally {
      spy.mockRestore();
      await rm(catDir, { recursive: true, force: true });
    }
  });
});
