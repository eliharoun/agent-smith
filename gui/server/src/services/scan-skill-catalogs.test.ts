import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, loadSkillCatalogs } from "./scan-skill-catalogs";

let dir: string;
let priorEnv: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scan-cats-"));
  // The repo-wide test preload sets SMITH_DISABLE_SKILL_BOOTSTRAP=1
  // (so fixture-driven tests see only the persisted catalogs). This
  // suite specifically exercises the bootstrap-injection behavior, so
  // we unset it here and restore in afterEach.
  priorEnv = process.env.SMITH_DISABLE_SKILL_BOOTSTRAP;
  delete process.env.SMITH_DISABLE_SKILL_BOOTSTRAP;
});
afterEach(async () => {
  if (priorEnv !== undefined) process.env.SMITH_DISABLE_SKILL_BOOTSTRAP = priorEnv;
  else delete process.env.SMITH_DISABLE_SKILL_BOOTSTRAP;
  await rm(dir, { recursive: true, force: true });
});

describe("loadSkillCatalogs", () => {
  it("returns the bootstrap defaults when registry file is missing", async () => {
    // Mirror of the CLI's loadSkillRegistry, which returns
    // defaultSkillRegistry() (containing the protected atlassian-skills
    // catalog) when no on-disk registry exists. The GUI used to return
    // [] here, which made the skills page show "no skills registered yet"
    // even though `smith skill list` showed atlassian-skills.
    const cats = await loadSkillCatalogs({ registryPath: join(dir, "nope.json") });
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.some((c) => c.label === "atlassian-skills")).toBe(true);
    expect(cats.find((c) => c.label === "atlassian-skills")?.protected).toBe(true);
  });

  it("opts out of bootstrap injection via the includeBootstrap flag", async () => {
    const cats = await loadSkillCatalogs({
      registryPath: join(dir, "nope.json"),
      includeBootstrap: false,
    });
    expect(cats).toEqual([]);
  });

  it("parses a valid registry", async () => {
    const path = join(dir, "skill-catalogs.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [{ kind: "user-global", rootPath: "/x", label: "a" }],
      }),
    );
    const cats = await loadSkillCatalogs({ registryPath: path });
    // The persisted entry plus the protected atlassian-skills bootstrap
    // (spliced in defensively, matching loadSkillRegistry's behavior).
    expect(cats.some((c) => c.label === "a")).toBe(true);
    expect(cats.some((c) => c.label === "atlassian-skills")).toBe(true);
  });

  it("does NOT splice the protected catalog when it's already in the registry", async () => {
    const path = join(dir, "skill-catalogs.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        catalogs: [
          {
            kind: "team-shared",
            rootPath: "/persisted",
            label: "atlassian-skills",
            protected: true,
          },
        ],
      }),
    );
    const cats = await loadSkillCatalogs({ registryPath: path });
    // Persisted version wins; no duplicate.
    const matches = cats.filter((c) => c.label === "atlassian-skills");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rootPath).toBe("/persisted");
  });

  it("falls back to bootstrap defaults on malformed JSON", async () => {
    const path = join(dir, "skill-catalogs.json");
    await writeFile(path, "not json");
    const cats = await loadSkillCatalogs({ registryPath: path });
    // Still gets the protected bootstrap so the GUI never shows "empty"
    // because of a corrupted file.
    expect(cats.some((c) => c.label === "atlassian-skills")).toBe(true);
  });
});

describe("discoverSkills", () => {
  it("walks SKILL.md and returns summaries", async () => {
    const cat = { kind: "user-global" as const, rootPath: dir, label: "L" };
    await mkdir(join(dir, "my-skill"));
    await writeFile(
      join(dir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: a test skill\n---\nbody",
    );
    const out = await discoverSkills(cat);
    expect(out).toEqual([
      {
        name: "my-skill",
        description: "a test skill",
        catalogLabel: "L",
        path: join(dir, "my-skill"),
        // v1.15.0: every summary now carries `protected` (false for user skills).
        protected: false,
      },
    ]);
  });

  it("skips dirs without SKILL.md", async () => {
    const cat = { kind: "user-global" as const, rootPath: dir, label: "L" };
    await mkdir(join(dir, "empty"));
    expect(await discoverSkills(cat)).toEqual([]);
  });

  it("discovers skills nested under a subdirectory (e.g. skills/<name>/SKILL.md)", async () => {
    const cat = { kind: "user-global" as const, rootPath: dir, label: "L" };
    await mkdir(join(dir, "skills", "alpha"), { recursive: true });
    await mkdir(join(dir, "skills", "beta"), { recursive: true });
    await writeFile(
      join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Alpha skill\n---\nbody",
    );
    await writeFile(
      join(dir, "skills", "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Beta skill\n---\nbody",
    );
    const out = await discoverSkills(cat);
    expect(out.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("does NOT descend into a skill directory — nested SKILL.md is not a separate skill", async () => {
    const cat = { kind: "user-global" as const, rootPath: dir, label: "L" };
    await mkdir(join(dir, "skills", "alpha", "references"), { recursive: true });
    await writeFile(
      join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Alpha skill\n---\nbody",
    );
    await writeFile(
      join(dir, "skills", "alpha", "references", "SKILL.md"),
      "---\nname: fake\ndescription: Should not appear\n---\nbody",
    );
    const out = await discoverSkills(cat);
    expect(out.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("skips skills with invalid names", async () => {
    const cat = { kind: "user-global" as const, rootPath: dir, label: "L" };
    await mkdir(join(dir, "BadName"));
    await writeFile(join(dir, "BadName", "SKILL.md"), "---\nname: BadName\ndescription: y\n---\n");
    expect(await discoverSkills(cat)).toEqual([]);
  });
});
