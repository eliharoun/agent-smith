import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstalledSkills } from "../../src/io/installed-skills";
import { installSkill, uninstallSkill, updateSkill } from "../../src/io/skill-installer";

let homeDir: string;
let sourceParent: string;
let platformDirs: { opencode: string; claudeCode: string; codex: string };

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "skill-installer-home-"));
  sourceParent = await mkdtemp(join(tmpdir(), "skill-installer-src-"));
  platformDirs = {
    opencode: join(homeDir, ".config/opencode/skills"),
    claudeCode: join(homeDir, ".claude/skills"),
    codex: join(homeDir, ".agents/skills"),
  };
  for (const d of Object.values(platformDirs)) await mkdir(d, { recursive: true });
});
afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  await rm(sourceParent, { recursive: true, force: true });
});

async function makeSkill(name: string, body = "# skill\n"): Promise<string> {
  const dir = join(sourceParent, name);
  await mkdir(join(dir, "scripts"), { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: t\n---\n${body}`);
  await writeFile(join(dir, "scripts/run.sh"), "#!/bin/sh\n");
  return dir;
}

describe("installSkill: sourceOverride path (no registry)", () => {
  test("copies skill into all three platform dirs and records state", async () => {
    const sourceDir = await makeSkill("the-architect");
    const result = await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
      now: () => new Date("2026-05-03T14:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const dir of Object.values(platformDirs)) {
      expect((await stat(join(dir, "the-architect"))).isDirectory()).toBe(true);
      expect(await readFile(join(dir, "the-architect/SKILL.md"), "utf8")).toContain(
        "name: the-architect",
      );
      expect(await readFile(join(dir, "the-architect/scripts/run.sh"), "utf8")).toContain(
        "/bin/sh",
      );
    }

    const file = await loadInstalledSkills({ homeDir });
    expect(file.installed).toHaveLength(1);
    const e = file.installed[0]!;
    expect(e.name).toBe("the-architect");
    expect(e.sourceCatalogLabel).toBe("bundled");
    expect(e.sourcePath).toBe(sourceDir);
    expect(e.installedPaths.opencode).toBe(join(platformDirs.opencode, "the-architect"));
    expect(e.installedPaths.claudeCode).toBe(join(platformDirs.claudeCode, "the-architect"));
    expect(e.installedPaths.codex).toBe(join(platformDirs.codex, "the-architect"));
    expect(e.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.installedAt).toBe("2026-05-03T14:00:00.000Z");
  });

  test("skips a platform whose dir does not exist", async () => {
    await rm(platformDirs.codex, { recursive: true, force: true });
    const sourceDir = await makeSkill("the-architect");
    const result = await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installed.installedPaths.codex).toBeUndefined();
    expect(result.installed.installedPaths.opencode).toBeDefined();
  });

  test("respects targets filter", async () => {
    const sourceDir = await makeSkill("the-architect");
    const result = await installSkill("the-architect", {
      platformDirs,
      homeDir,
      targets: ["opencode"],
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installed.installedPaths.opencode).toBeDefined();
    expect(result.installed.installedPaths.claudeCode).toBeUndefined();
    expect(result.installed.installedPaths.codex).toBeUndefined();
  });

  test("errors if skill is already installed (caller must use update)", async () => {
    const sourceDir = await makeSkill("the-architect");
    await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    const second = await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already installed/);
    expect(second.error).toMatch(/smith skill update/);
  });

  test("contentHash equals hashSkillDir(firstInstalledPath) after install (IO-22 contract)", async () => {
    const sourceDir = await makeSkill("io-22-install");
    const result = await installSkill("io-22-install", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // First installed destination per opencode → claudeCode → codex order.
    const firstDest = result.installed.installedPaths.opencode;
    expect(firstDest).toBeDefined();
    if (!firstDest) return;

    const { hashSkillDir } = await import("../../src/io/installed-skills");
    const destHash = await hashSkillDir(firstDest);
    expect(result.installed.contentHash).toBe(destHash);
  });

  test("falls back to claudeCode when opencode platform dir is absent (IO-22 ordering)", async () => {
    // Remove opencode platform dir so first installed dest is claudeCode.
    await rm(platformDirs.opencode, { recursive: true, force: true });
    const sourceDir = await makeSkill("io-22-fallback");
    const result = await installSkill("io-22-fallback", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.installed.installedPaths.opencode).toBeUndefined();
    const firstDest = result.installed.installedPaths.claudeCode;
    expect(firstDest).toBeDefined();
    if (!firstDest) return;

    const { hashSkillDir } = await import("../../src/io/installed-skills");
    expect(result.installed.contentHash).toBe(await hashSkillDir(firstDest));
  });

  test("returns error when no platforms could be written (IO-22 empty installedPaths)", async () => {
    // Remove all three platform dirs so installedPaths comes back empty
    // (copyToPlatforms's "skip if !pathExists(baseDir)" branch).
    await rm(platformDirs.opencode, { recursive: true, force: true });
    await rm(platformDirs.claudeCode, { recursive: true, force: true });
    await rm(platformDirs.codex, { recursive: true, force: true });
    const sourceDir = await makeSkill("io-22-empty");
    const result = await installSkill("io-22-empty", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no platforms written/i);
  });
});

async function pathStillThere(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("updateSkill", () => {
  test("re-copies and bumps contentHash + installedAt", async () => {
    const sourceDir = await makeSkill("the-architect", "v1");
    await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
      now: () => new Date("2026-05-03T14:00:00Z"),
    });
    const before = (await loadInstalledSkills({ homeDir })).installed[0]!;

    await writeFile(join(sourceDir, "SKILL.md"), "v2 changed");

    const result = await updateSkill("the-architect", {
      platformDirs,
      homeDir,
      now: () => new Date("2026-05-03T15:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await readFile(join(platformDirs.opencode, "the-architect/SKILL.md"), "utf8")).toContain(
      "v2 changed",
    );
    expect(result.installed.contentHash).not.toBe(before.contentHash);
    expect(result.installed.installedAt).toBe("2026-05-03T15:00:00.000Z");
  });

  test("errors when skill not installed", async () => {
    const result = await updateSkill("missing", { platformDirs, homeDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not installed/);
  });

  test("contentHash equals hashSkillDir(firstInstalledPath) after update (IO-22 contract)", async () => {
    const sourceDir = await makeSkill("io-22-update");
    await installSkill("io-22-update", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: io-22-update\ndescription: t\n---\n# v2\n",
    );
    const result = await updateSkill("io-22-update", { platformDirs, homeDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const firstDest = result.installed.installedPaths.opencode;
    expect(firstDest).toBeDefined();
    if (!firstDest) return;

    const { hashSkillDir } = await import("../../src/io/installed-skills");
    const destHash = await hashSkillDir(firstDest);
    expect(result.installed.contentHash).toBe(destHash);
  });
});

describe("uninstallSkill", () => {
  test("removes from all platform dirs and state file", async () => {
    const sourceDir = await makeSkill("the-architect");
    await installSkill("the-architect", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "bundled" },
    });

    const result = await uninstallSkill("the-architect", { platformDirs, homeDir });
    expect(result.ok).toBe(true);

    for (const dir of Object.values(platformDirs)) {
      expect(await pathStillThere(join(dir, "the-architect"))).toBe(false);
    }
    const file = await loadInstalledSkills({ homeDir });
    expect(file.installed).toHaveLength(0);
  });

  test("errors when skill not installed", async () => {
    const result = await uninstallSkill("missing", { platformDirs, homeDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not installed/);
  });
});

describe("installSkill: registry path (findSkill seam)", () => {
  test("looks up skill via findSkill seam and copies it", async () => {
    const sourceDir = await makeSkill("jira-helper");
    const result = await installSkill("jira-helper", {
      platformDirs,
      homeDir,
      findSkill: async () => ({
        name: "jira-helper",
        path: sourceDir,
        frontmatter: { name: "jira-helper", description: "t" },
        catalogLabel: "team",
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.installed.sourceCatalogLabel).toBe("team");
    expect(result.installed.sourcePath).toBe(sourceDir);
  });

  test("propagates 'ambiguous' error from findSkill with remediation", async () => {
    const result = await installSkill("ambig", {
      platformDirs,
      homeDir,
      findSkill: async () => ({
        error: "ambiguous" as const,
        matches: [
          {
            name: "ambig",
            path: "/a",
            frontmatter: { name: "ambig", description: "t" },
            catalogLabel: "a",
          },
          {
            name: "ambig",
            path: "/b",
            frontmatter: { name: "ambig", description: "t" },
            catalogLabel: "b",
          },
        ],
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ambiguous/);
    expect(result.error).toMatch(/a\/ambig/);
    expect(result.error).toMatch(/b\/ambig/);
  });

  test("propagates 'not-found' error", async () => {
    const result = await installSkill("ghost", {
      platformDirs,
      homeDir,
      findSkill: async () => ({ error: "not-found" as const }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/);
  });
});

describe("uninstallSkill: adhoc auto-cleanup", () => {
  test("removes the source catalog when it was adhoc and no other skills reference it", async () => {
    const registryPath = join(homeDir, ".config/agent-smith/skill-catalogs.json");
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify(
        {
          version: 1,
          catalogs: [
            {
              kind: "user-global",
              rootPath: "/some/team/path",
              label: "team",
            },
            {
              kind: "user-local",
              rootPath: sourceParent,
              label: "csv-helper",
              adhoc: true,
            },
          ],
        },
        null,
        2,
      ),
    );

    const sourceDir = await makeSkill("csv-helper");
    await installSkill("csv-helper", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "csv-helper" },
    });

    await uninstallSkill("csv-helper", { platformDirs, homeDir });

    const reg = JSON.parse(await readFile(registryPath, "utf8")) as {
      catalogs: { label: string }[];
    };
    // The adhoc catalog is removed; the non-adhoc catalog remains.
    // atlassian-skills is re-injected as a protected default by loadSkillRegistry.
    expect(reg.catalogs.map((c) => c.label)).toEqual(["atlassian-skills", "team"]);
  });

  test("keeps non-adhoc catalogs even when the only installed skill is removed", async () => {
    const registryPath = join(homeDir, ".config/agent-smith/skill-catalogs.json");
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify(
        {
          version: 1,
          catalogs: [{ kind: "user-global", rootPath: "/some/team", label: "team" }],
        },
        null,
        2,
      ),
    );

    const sourceDir = await makeSkill("jira-helper");
    await installSkill("jira-helper", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "team" },
    });
    await uninstallSkill("jira-helper", { platformDirs, homeDir });

    const reg = JSON.parse(await readFile(registryPath, "utf8")) as {
      catalogs: { label: string }[];
    };
    // No mutation expected here (team is non-adhoc), so the file remains
    // exactly as we wrote it — without the synthetic example-pack.
    expect(reg.catalogs.map((c) => c.label)).toEqual(["team"]);
  });
});

describe("installSkill: name validation (path-traversal guard)", () => {
  const bogus = ["../escape", "evil/sub", "..", ".hidden", "", "a".repeat(65), "Up", "with space"];
  for (const n of bogus) {
    test(`rejects '${n}'`, async () => {
      const result = await installSkill(n, {
        platformDirs,
        homeDir,
        sourceOverride: { sourceDir: sourceParent, sourceCatalogLabel: "x" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/invalid skill name/i);
    });
  }

  test("updateSkill rejects bogus name", async () => {
    const r = await updateSkill("../escape", { platformDirs, homeDir });
    expect(r.ok).toBe(false);
  });

  test("uninstallSkill rejects bogus name", async () => {
    const r = await uninstallSkill("../escape", { platformDirs, homeDir });
    expect(r.ok).toBe(false);
  });
});

describe("installSkill: rollback on partial failure", () => {
  test("rolls back already-written platforms when later platform fails", async () => {
    const sourceDir = await makeSkill("rollback-me");
    // Make the codex platform dir read-only so its mkdir/cp fails. opencode
    // and claude-code will succeed first; rollback must remove them.
    await chmod(platformDirs.codex, 0o500);
    try {
      const result = await installSkill("rollback-me", {
        platformDirs,
        homeDir,
        sourceOverride: { sourceDir, sourceCatalogLabel: "x" },
      });
      expect(result.ok).toBe(false);
      // Both successfully-written platforms should be cleaned up.
      for (const dir of [platformDirs.opencode, platformDirs.claudeCode]) {
        await expect(stat(join(dir, "rollback-me"))).rejects.toThrow();
      }
      // State file must NOT contain the entry.
      const file = await loadInstalledSkills({ homeDir });
      expect(file.installed.find((e) => e.name === "rollback-me")).toBeUndefined();
    } finally {
      await chmod(platformDirs.codex, 0o755);
    }
  });
});

describe("installSkill: symlink-safe copy (#6)", () => {
  test("symlinks in source are preserved as symlinks (not dereferenced)", async () => {
    const sourceDir = await makeSkill("symlinked");
    // Create a symlink inside the source dir pointing OUTSIDE the source.
    const outside = join(sourceParent, "outside-target.txt");
    await writeFile(outside, "SECRET\n");
    await symlink(outside, join(sourceDir, "danger-link"));

    const result = await installSkill("symlinked", {
      platformDirs,
      homeDir,
      sourceOverride: { sourceDir, sourceCatalogLabel: "x" },
    });
    expect(result.ok).toBe(true);

    const linkAtDest = join(platformDirs.opencode, "symlinked/danger-link");
    const st = await lstat(linkAtDest);
    expect(st.isSymbolicLink()).toBe(true);
  });
});

describe("hashSkillDir: symlink + large-file hardening (#5)", () => {
  test("symlinks in source are recorded but not followed", async () => {
    const { hashSkillDir } = await import("../../src/io/installed-skills");
    const dir = await makeSkill("hash-sym");
    // Symlink to a file outside the dir; must NOT be hashed.
    const outside = join(sourceParent, "secret-outside.txt");
    await writeFile(outside, "SECRET-CONTENT\n");
    await symlink(outside, join(dir, "link-out"));
    const h1 = await hashSkillDir(dir);

    // Mutate the OUTSIDE target. Hash must remain stable since we don't
    // dereference symlinks anymore.
    await writeFile(outside, "DIFFERENT-CONTENT\n");
    const h2 = await hashSkillDir(dir);
    expect(h1).toBe(h2);
  });

  test("symlink loop in source does not hang or throw", async () => {
    const { hashSkillDir } = await import("../../src/io/installed-skills");
    const dir = await makeSkill("hash-loop");
    // a -> b -> a loop INSIDE the skill dir.
    await symlink(join(dir, "loop-b"), join(dir, "loop-a"));
    await symlink(join(dir, "loop-a"), join(dir, "loop-b"));
    // Should complete promptly (lstat-only walk).
    const h = await hashSkillDir(dir);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("file > 10MB is recorded as SKIPPED-LARGE (not read into memory)", async () => {
    const { hashSkillDir } = await import("../../src/io/installed-skills");
    const dir = await makeSkill("hash-big");
    // Sparse-ish 11MB file via repeated buffer writes.
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
    await writeFile(join(dir, "huge.bin"), big);
    const h1 = await hashSkillDir(dir);

    // Change the huge file; hash must remain unchanged because contents
    // are skipped (we only record "SKIPPED-LARGE" for them).
    big.fill(0x42);
    await writeFile(join(dir, "huge.bin"), big);
    const h2 = await hashSkillDir(dir);
    expect(h1).toBe(h2);
  });
});
