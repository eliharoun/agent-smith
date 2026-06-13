import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillList } from "../../src/cli/commands/skill/list";
import { type SkillRegistry, saveSkillRegistry } from "../../src/io/skill-registry";

let dir: string;
let registryPath: string;
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

async function mkSkill(rootDir: string, name: string, desc = "X."): Promise<void> {
  const d = join(rootDir, name);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\nbody\n`);
}

/**
 * loadSkillRegistry now re-injects the atlassian-skills catalog (whose
 * rootPath derives from xdgStateHome(), which on macOS ignores $HOME) when the
 * on-disk file lacks any atlassian-skills entry. Including a stub
 * atlassian-skills pointing at a tmp dir suppresses that injection and keeps
 * these tests hermetic — no leakage from the maintainer's real clone path.
 */
function withStubAtlassianSkills(
  catalogs: SkillRegistry["catalogs"],
  tmpDir: string,
): SkillRegistry {
  const stubRoot = join(tmpDir, "_atlassian_stub");
  return {
    schemaVersion: 2,
    catalogs: [
      { kind: "team-shared", rootPath: stubRoot, label: "atlassian-skills", protected: true },
      ...catalogs,
    ],
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-list-"));
  registryPath = join(dir, "skill-catalogs.json");
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  errSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  // Restore the console spies so each test starts with fresh mock.calls.
  // Without this, spyOn accumulates calls across the whole file lifetime, so
  // tests that index into logSpy.mock.calls (e.g. findIndex for a skill name)
  // see prior tests' output — making their result depend on execution order,
  // which differs between environments (green locally, red on the CI runner).
  logSpy.mockRestore();
  errSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

describe("cli/skill list", () => {
  test("with no skills prints '(no skills found)'", async () => {
    const empty = join(dir, "empty");
    await mkdir(empty, { recursive: true });
    const reg = withStubAtlassianSkills(
      [{ kind: "user-global", rootPath: empty, label: "empty-cat" }],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    const code = await skillList({}, { registryPath });
    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join(" ")).toContain("no skills found");
  });

  test("prints one line per skill with name, description excerpt, catalog label", async () => {
    const cat = join(dir, "c");
    await mkSkill(cat, "alpha", "alpha desc");
    const reg = withStubAtlassianSkills(
      [{ kind: "user-global", rootPath: cat, label: "main" }],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    await skillList({}, { registryPath });
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("alpha");
    expect(out).toContain("main");
    expect(out).toContain("alpha desc");
  });

  test("hides skills from catalogs marked adhoc=true by default", async () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    await mkSkill(a, "visible");
    await mkSkill(b, "hidden");
    const reg = withStubAtlassianSkills(
      [
        { kind: "user-global", rootPath: a, label: "norm" },
        { kind: "user-global", rootPath: b, label: "ad", adhoc: true },
      ],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    await skillList({}, { registryPath });
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("visible");
    expect(out).not.toContain("hidden");
  });

  test("--all includes skills from adhoc catalogs", async () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    await mkSkill(a, "visible");
    await mkSkill(b, "extra");
    const reg = withStubAtlassianSkills(
      [
        { kind: "user-global", rootPath: a, label: "norm" },
        { kind: "user-global", rootPath: b, label: "ad", adhoc: true },
      ],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    await skillList({ all: true }, { registryPath });
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("visible");
    expect(out).toContain("extra");
  });

  test("aggregates across multiple catalogs and sorts globally by name", async () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    await mkSkill(a, "zeta");
    await mkSkill(b, "alpha");
    const reg = withStubAtlassianSkills(
      [
        { kind: "user-global", rootPath: a, label: "ca" },
        { kind: "user-local", rootPath: b, label: "cb" },
      ],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    await skillList({}, { registryPath });
    const lines = logSpy.mock.calls.map((c: unknown[]) => c.join(" "));
    const alphaIdx = lines.findIndex((l: string) => l.includes("alpha"));
    const zetaIdx = lines.findIndex((l: string) => l.includes("zeta"));
    expect(alphaIdx).toBeLessThan(zetaIdx);
  });

  test("catches and reports per-catalog discovery errors without aborting other catalogs", async () => {
    const ok = join(dir, "ok");
    const bad = join(dir, "bad");
    await mkSkill(ok, "good");
    // Bad skill: invalid YAML
    await mkdir(join(bad, "broken"), { recursive: true });
    await writeFile(join(bad, "broken", "SKILL.md"), "no frontmatter here\n");
    const reg = withStubAtlassianSkills(
      [
        { kind: "user-global", rootPath: ok, label: "ok-cat" },
        { kind: "user-global", rootPath: bad, label: "bad-cat" },
      ],
      dir,
    );
    await saveSkillRegistry(registryPath, reg);
    const code = await skillList({}, { registryPath });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("good");
    const errOut = errSpy.mock.calls.flat().join(" ");
    expect(errOut).toMatch(/bad-cat/);
  });
});
