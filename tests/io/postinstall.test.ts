// Postinstall mode contract:
//   1. NEVER throws (always returns) — even on filesystem errors.
//   2. Returns errors as warnings (no errors[]).
//   3. The postinstall ENTRY POINT exits 0 even if bootstrap reports warnings.
//   4. Honors AGENT_SMITH_SKIP_POSTINSTALL=1 by skipping the run.
//   5. Skipped when CI=true is set.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../../scripts/bootstrap";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-postinstall-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("bootstrap postinstall contract", () => {
  test("real-dir at dest with DIFFERENT contents is replaced WITH a warning", async () => {
    // Spec §7.4: the architect skill is a tracked artifact, so postinstall
    // is allowed to overwrite — but the user MUST be warned that local
    // edits are about to be nuked. Silent overwrite would let an npm
    // install destroy hand-customizations without trace.
    const repoRoot = join(tmp, "repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });
    await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect (bundled)\n");
    await mkdir(join(repoRoot, "skills/the-keymaker"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-keymaker/SKILL.md"), "# the-keymaker\n");
    const opencode = join(tmp, "p/opencode/skills");
    await mkdir(opencode, { recursive: true });
    // Pre-existing dir with DIFFERENT content (a user-customized skill).
    await mkdir(join(opencode, "the-architect"));
    await writeFile(join(opencode, "the-architect/SKILL.md"), "# user-edited\n");

    const result = await bootstrap({
      repoRoot,
      platforms: {
        opencode,
        "claude-code": join(tmp, "p/claude/missing"),
        codex: join(tmp, "p/codex/missing"),
      },
      mode: "postinstall",
      homeDir,
    });

    expect(result.errors).toEqual([]);
    // The install proceeds (skill is tracked), but a warning is emitted.
    expect(result.warnings.some((w) => /the-architect/.test(w))).toBe(true);
    expect(result.skillsLinked).toBe(2);
  });

  test("real-dir at dest with IDENTICAL contents installs silently (no warning)", async () => {
    // Re-running postinstall after a clean install should be quiet — there
    // is nothing to warn about because the bytes already match.
    const repoRoot = join(tmp, "repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });
    await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");
    await mkdir(join(repoRoot, "skills/the-keymaker"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-keymaker/SKILL.md"), "# the-keymaker\n");
    const opencode = join(tmp, "p/opencode/skills");
    await mkdir(opencode, { recursive: true });
    await mkdir(join(opencode, "the-architect"));
    await mkdir(join(opencode, "the-keymaker"));
    // Same bytes as the bundled source.
    await writeFile(join(opencode, "the-architect/SKILL.md"), "# the-architect\n");
    await writeFile(join(opencode, "the-keymaker/SKILL.md"), "# the-keymaker\n");

    const result = await bootstrap({
      repoRoot,
      platforms: {
        opencode,
        "claude-code": join(tmp, "p/claude/missing"),
        codex: join(tmp, "p/codex/missing"),
      },
      mode: "postinstall",
      homeDir,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.skillsLinked).toBe(2);
  });

  test("missing skill source produces warning, not throw", async () => {
    const repoRoot = join(tmp, "empty-repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    const result = await bootstrap({
      repoRoot,
      platforms: {
        opencode: join(tmp, "p/oc"),
        "claude-code": join(tmp, "p/cc"),
        codex: join(tmp, "p/cx"),
      },
      mode: "postinstall",
      homeDir,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("bootstrap multi-skill installation", () => {
  test("both skills (the-architect + the-keymaker) install successfully to all platform dirs", async () => {
    const repoRoot = join(tmp, "repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });

    // Create both bundled skill sources
    await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");
    await mkdir(join(repoRoot, "skills/the-keymaker"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-keymaker/SKILL.md"), "# the-keymaker\n");

    // Create all platform dirs (needed per QA wisdom: bootstrap skips missing dirs)
    const opencode = join(tmp, "p/opencode/skills");
    const claudeCode = join(tmp, "p/claude/skills");
    const codex = join(tmp, "p/codex/skills");
    await mkdir(opencode, { recursive: true });
    await mkdir(claudeCode, { recursive: true });
    await mkdir(codex, { recursive: true });

    const result = await bootstrap({
      repoRoot,
      platforms: {
        opencode,
        "claude-code": claudeCode,
        codex,
      },
      mode: "postinstall",
      homeDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.bundledSkillsInstalled).toBe(2);
    expect(result.skillsLinked).toBe(6); // 2 skills × 3 platforms
    expect(result.warnings).toEqual([]);
  });

  test("graceful degradation when the-keymaker source is missing", async () => {
    const repoRoot = join(tmp, "repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });

    // Create only the-architect source (the-keymaker is missing)
    await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");

    const opencode = join(tmp, "p/opencode/skills");
    await mkdir(opencode, { recursive: true });

    const result = await bootstrap({
      repoRoot,
      platforms: {
        opencode,
        "claude-code": join(tmp, "p/claude/missing"),
        codex: join(tmp, "p/codex/missing"),
      },
      mode: "postinstall",
      homeDir,
    });

    // Postinstall mode never returns errors (fail-soft contract)
    expect(result.errors).toEqual([]);
    // the-architect installs successfully
    expect(result.bundledSkillsInstalled).toBe(1);
    expect(result.skillsLinked).toBe(1);
    // the-keymaker failure produces a warning
    expect(result.bundledSkillsFailed).toBe(1);
    expect(result.warnings.some((w) => /the-keymaker/.test(w))).toBe(true);
  });

  test("installed-skills.json records both skills with correct metadata", async () => {
    const repoRoot = join(tmp, "repo");
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });

    // Create both skill sources
    await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");
    await mkdir(join(repoRoot, "skills/the-keymaker"), { recursive: true });
    await writeFile(join(repoRoot, "skills/the-keymaker/SKILL.md"), "# the-keymaker\n");

    const opencode = join(tmp, "p/opencode/skills");
    await mkdir(opencode, { recursive: true });

    await bootstrap({
      repoRoot,
      platforms: {
        opencode,
        "claude-code": join(tmp, "p/claude/missing"),
        codex: join(tmp, "p/codex/missing"),
      },
      mode: "postinstall",
      homeDir,
    });

    // Load and verify the state file
    const { loadInstalledSkills } = await import("../../src/io/installed-skills");
    const state = await loadInstalledSkills({ homeDir });

    expect(state.schemaVersion).toBe(1);
    expect(state.installed.length).toBe(2);

    // Verify the-architect entry
    const architect = state.installed.find((s) => s.name === "the-architect");
    expect(architect).toBeDefined();
    expect(architect!.sourceCatalogLabel).toBe("bundled");
    expect(architect!.contentHash).toBeTruthy();
    expect(architect!.installedPaths.opencode).toBe(join(opencode, "the-architect"));

    // Verify the-keymaker entry
    const keymaker = state.installed.find((s) => s.name === "the-keymaker");
    expect(keymaker).toBeDefined();
    expect(keymaker!.sourceCatalogLabel).toBe("bundled");
    expect(keymaker!.contentHash).toBeTruthy();
    expect(keymaker!.installedPaths.opencode).toBe(join(opencode, "the-keymaker"));
  });
});

describe("postinstall entry-point exit code", () => {
  test("AGENT_SMITH_SKIP_POSTINSTALL=1 skips the run with exit 0", async () => {
    const proc = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "../../scripts/bootstrap.ts"), "--mode=postinstall"],
      {
        env: {
          ...process.env,
          AGENT_SMITH_SKIP_POSTINSTALL: "1",
          // Unset CI so we test the env-var path specifically
          CI: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out.toLowerCase()).toContain("skipped");
  });

  test("CI=true skips the run with exit 0", async () => {
    const proc = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "../../scripts/bootstrap.ts"), "--mode=postinstall"],
      {
        env: {
          ...process.env,
          CI: "true",
          AGENT_SMITH_SKIP_POSTINSTALL: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(proc.exitCode).toBe(0);
  });
});

describe("postinstall summary string", () => {
  // Pin: after Batch 20 (bootstrap consolidation), the postinstall summary
  // no longer mentions agents because the persona is installed by Step 9
  // of bin/install + Step 4 of smith update, not by bootstrap.
  test("postinstall summary line does not mention 'agents installed'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-bootstrap-summary-"));
    try {
      const repoRoot = join(tmp, "repo");
      await mkdir(join(repoRoot, "skills/the-architect"), { recursive: true });
      await writeFile(join(repoRoot, "skills/the-architect/SKILL.md"), "# the-architect\n");
      await mkdir(join(repoRoot, "skills/the-keymaker"), { recursive: true });
      await writeFile(join(repoRoot, "skills/the-keymaker/SKILL.md"), "# the-keymaker\n");

      // NOTE: scripts/bootstrap.ts resolves repoRoot from import.meta.url,
      // so the synthetic `repoRoot` we set up in tmp is NOT actually used
      // by the spawned subprocess. The real script installs from the
      // maintainer's checkout. This is fine for this test — we only assert
      // the summary string wording, which is independent of which repo
      // gets installed. The synthetic-repo scaffolding is left in place
      // because it makes the test resilient to future refactors that
      // might honour cwd.

      // Spawn the postinstall entry point with our synthetic repo as cwd
      // and HOME pointing into tmp so installed-skills.json is hermetic.
      const homeDir = join(tmp, "home");
      await mkdir(homeDir, { recursive: true });
      const proc = Bun.spawnSync(
        [
          process.execPath,
          join(import.meta.dir, "../../scripts/bootstrap.ts"),
          "--mode=postinstall",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            AGENT_SMITH_SKIP_POSTINSTALL: "",
            CI: "",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(proc.exitCode).toBe(0);
      const out = proc.stdout.toString() + proc.stderr.toString();
      // Whatever else the line contains, it must NOT mention agents.
      expect(out).not.toMatch(/agents installed/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
