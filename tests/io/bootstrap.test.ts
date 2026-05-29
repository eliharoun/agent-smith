// Bootstrap I/O tests. The architect skill is COPIED via
// installSkill rather than symlinked (so doctor can detect drift via
// content-hash). Tests therefore assert directory + file contents and
// state-file presence, not symlink targets.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstalledSkills } from "../../src/io/installed-skills";
import { bootstrap } from "../../scripts/bootstrap";

let tmp: string;
let homeDir: string;
let repoRoot: string;
let platforms: { opencode: string; "claude-code": string; codex: string };

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-bootstrap-"));
  homeDir = join(tmp, "home");
  await mkdir(homeDir, { recursive: true });
  repoRoot = join(tmp, "repo");
  // Mock skill source inside repo
  await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
  await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");
  // Three platform target dirs (each is the "skills" dir for that platform)
  platforms = {
    opencode: join(tmp, "platforms/opencode/skills"),
    "claude-code": join(tmp, "platforms/claude/skills"),
    codex: join(tmp, "platforms/codex/skills"),
  };
  for (const p of Object.values(platforms)) {
    await mkdir(p, { recursive: true });
  }
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("bootstrap: skill install", () => {
  test("copies the-architect into all three platform dirs and records state", async () => {
    const result = await bootstrap({
      repoRoot,
      platforms,
      mode: "cli",
      homeDir,
    });

    for (const [name, dir] of Object.entries(platforms)) {
      const dest = join(dir, "the-architect");
      const stat = await lstat(dest);
      expect(stat.isDirectory(), `${name} dest should be a directory (not a symlink)`).toBe(true);
      const skillMd = await readFile(join(dest, "SKILL.md"), "utf8");
      const sourceMd = await readFile(
        join(repoRoot, "skills/the-architect/SKILL.md"),
        "utf8",
      );
      expect(skillMd).toBe(sourceMd);
    }
    expect(result.skillsLinked).toBe(3);
    expect(result.skillsSkipped).toBe(0);
    expect(result.errors).toEqual([]);

    // State-file assertion: installed-skills.json now lists the architect.
    const file = await loadInstalledSkills({ homeDir });
    expect(file.installed.map((e) => e.name)).toContain("the-architect");
    const e = file.installed.find((x) => x.name === "the-architect")!;
    expect(e.sourceCatalogLabel).toBe("bundled");
  });
});

describe("bootstrap: idempotency", () => {
  test("running twice succeeds without errors and leaves a single dest dir", async () => {
    const r1 = await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });
    expect(r1.errors).toEqual([]);
    expect(r1.skillsLinked).toBe(3);

    const r2 = await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });
    expect(r2.errors).toEqual([]);
    // Second run takes the updateSkill path; still re-copies to all 3 platforms.
    expect(r2.skillsLinked).toBe(3);

    for (const dir of Object.values(platforms)) {
      const entries = await readdir(dir);
      expect(entries).toEqual(["the-architect"]);
    }
  });

  test("contentHash is stable across re-runs when source bytes are unchanged", async () => {
    // Tautology guard: the previous test only checked that the second run
    // doesn't error. Without this assertion, the installer could (and used
    // to be at risk of) silently re-hashing junk and we'd never notice.
    await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });
    const hashBefore = (await loadInstalledSkills({ homeDir })).installed.find(
      (e) => e.name === "the-architect",
    )!.contentHash;

    await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });
    const hashAfter = (await loadInstalledSkills({ homeDir })).installed.find(
      (e) => e.name === "the-architect",
    )!.contentHash;

    // installedAt may move; contentHash MUST NOT (source didn't change).
    expect(hashAfter).toBe(hashBefore);
  });
});

describe("bootstrap: pre-existing dest dir is replaced", () => {
  // Old behavior: bootstrap symlinked and refused to overwrite a
  // real directory at the dest. Current behavior: the installer
  // unconditionally replaces the dest dir so doctor's content-hash check
  // remains the source of truth. Track this here to flag any regression.
  test("replaces a real directory at the dest with the bundled skill (cli mode)", async () => {
    await mkdir(join(platforms.opencode, "the-architect"), { recursive: true });
    await writeFile(
      join(platforms.opencode, "the-architect/REAL.md"),
      "real file, not a symlink target\n",
    );

    const result = await bootstrap({
      repoRoot,
      platforms,
      mode: "cli",
      homeDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.skillsLinked).toBe(3);
    // The REAL.md is gone — replaced wholesale.
    await expect(
      readFile(join(platforms.opencode, "the-architect/REAL.md"), "utf8"),
    ).rejects.toThrow();
    // The new SKILL.md is from the bundled source.
    const skillMd = await readFile(
      join(platforms.opencode, "the-architect/SKILL.md"),
      "utf8",
    );
    expect(skillMd).toBe(
      await readFile(join(repoRoot, "skills/the-architect/SKILL.md"), "utf8"),
    );
  });
});

describe("bootstrap: missing platform dir", () => {
  test("skips silently if a platform skills dir does not exist", async () => {
    await rm(platforms.codex, { recursive: true, force: true });

    const result = await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });

    expect(result.errors).toEqual([]);
    expect(result.skillsLinked).toBe(2); // opencode + claude-code only
    expect(result.skillsSkipped).toBe(1);
  });
});

describe("bootstrap: dry-run", () => {
  test("dry-run reports what would happen but touches no files", async () => {
    const result = await bootstrap({
      repoRoot,
      platforms,
      mode: "cli",
      dryRun: true,
      homeDir,
    });

    expect(result.skillsLinked).toBe(3);
    expect(result.errors).toEqual([]);

    // Verify nothing was actually created on disk.
    for (const dir of Object.values(platforms)) {
      const entries = await readdir(dir);
      expect(entries).toEqual([]);
    }
    // No state file written either.
    const stateFile = join(homeDir, ".config/agent-smith/installed-skills.json");
    await expect(readFile(stateFile, "utf8")).rejects.toThrow();
  });
});

describe("bootstrap: missing skill source", () => {
  test("warns and returns 0 linked when skills/the-architect does not exist", async () => {
    await rm(join(repoRoot, "skills"), { recursive: true, force: true });

    const result = await bootstrap({ repoRoot, platforms, mode: "cli", homeDir });

    expect(result.errors).toEqual([]);
    expect(result.skillsLinked).toBe(0);
    expect(result.warnings.some((w) => w.includes("Skill source not found"))).toBe(true);
  });
});

