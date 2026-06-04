import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBundle } from "../../src/core/export-bundle";
import { installFromArchive } from "../../src/core/install-from-archive";

const FIXTURE = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");
const FIXTURE_WITH_SKILL = join(import.meta.dir, "..", "_fixtures", "export-bundle-with-skill");
const FIXTURE_SKILL_DIR = join(import.meta.dir, "..", "_fixtures", "export-skill");
const FIXTURE_LOCAL_K = join(import.meta.dir, "..", "_fixtures", "export-bundle-with-local-knowledge");

let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "export-roundtrip-"));
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

describe("export round-trip", () => {
  test("export → import → re-export yields the same bundle.contentHash", async () => {
    // Export 1
    const r1 = await exportBundle({
      bundlePath: FIXTURE,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const archive1Path = join(home, "first.smith-bundle.tgz");
    await writeFile(archive1Path, r1.archive);

    // Import on a clean home
    const importResult = await installFromArchive({
      archivePath: archive1Path,
      smithVersion: "1.7.0",
    });

    // Re-export from the imported catalog
    const r2 = await exportBundle({
      bundlePath: join(importResult.catalogRootPath, "minimal-bundle"),
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
    });

    expect(r2.contentHash).toBe(r1.contentHash);
  });

  test("export with --include-skills → import → re-export preserves skill bundles", async () => {
    const r1 = await exportBundle({
      bundlePath: FIXTURE_WITH_SKILL,
      bundleName: "with-skill-bundle",
      includeSkills: true,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
      resolveSkill: async (name) => {
        if (name === "fixture-skill") return join(FIXTURE_SKILL_DIR, "fixture-skill");
        return null;
      },
    });
    const archive1Path = join(home, "with-skill.smith-bundle.tgz");
    await writeFile(archive1Path, r1.archive);

    const importResult = await installFromArchive({
      archivePath: archive1Path,
      smithVersion: "1.7.0",
    });

    // Re-export from the imported catalog, resolving the embedded skill from the staged location.
    const r2 = await exportBundle({
      bundlePath: join(importResult.catalogRootPath, "with-skill-bundle"),
      bundleName: "with-skill-bundle",
      includeSkills: true,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
      resolveSkill: async (name) => {
        if (name === "fixture-skill") {
          return join(importResult.catalogRootPath, "with-skill-bundle", "skills", "fixture-skill");
        }
        return null;
      },
    });

    expect(r2.contentHash).toBe(r1.contentHash);
    expect(r2.manifest.requires.skills).toEqual([{ name: "fixture-skill", embedded: true }]);
  });

  test("export with local knowledge → import → re-export preserves notes", async () => {
    const r1 = await exportBundle({
      bundlePath: FIXTURE_LOCAL_K,
      bundleName: "local-knowledge-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const archive1Path = join(home, "local-knowledge.smith-bundle.tgz");
    await writeFile(archive1Path, r1.archive);

    const importResult = await installFromArchive({
      archivePath: archive1Path,
      smithVersion: "1.7.0",
    });

    // Verify the notes file survived the import.
    const notes = await readFile(
      join(importResult.catalogRootPath, "local-knowledge-bundle", "notes", "intro.md"),
      "utf8",
    );
    expect(notes).toContain("Intro");

    // Re-export and confirm contentHash stability.
    const r2 = await exportBundle({
      bundlePath: join(importResult.catalogRootPath, "local-knowledge-bundle"),
      bundleName: "local-knowledge-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    expect(r2.contentHash).toBe(r1.contentHash);
  });
});
