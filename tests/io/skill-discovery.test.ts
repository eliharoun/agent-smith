import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  discoverSkills,
  resolveAdHocSource,
  validateSkillName,
} from "../../src/io/skill-discovery";
import type { SkillCatalog } from "../../src/io/skill-registry";

let dir: string;
let catalog: SkillCatalog;

async function mkSkill(name: string, body: string, opts: { dirname?: string } = {}): Promise<void> {
  const skillDir = join(dir, opts.dirname ?? name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), body);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-disc-"));
  catalog = { kind: "user-global", rootPath: dir, label: "test-cat" };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("io/skill-discovery — discoverSkills", () => {
  test("returns empty when rootPath does not exist", async () => {
    const missing = { ...catalog, rootPath: join(dir, "nope") };
    expect(await discoverSkills(missing)).toEqual([]);
  });

  test("returns empty when rootPath has no skill subdirs", async () => {
    expect(await discoverSkills(catalog)).toEqual([]);
  });

  test("finds one skill — name, description, path, catalogLabel populated correctly", async () => {
    await mkSkill("hello", "---\nname: hello\ndescription: Greets the user.\n---\n# body\n");
    const found = await discoverSkills(catalog);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("hello");
    expect(found[0]?.path).toBe(join(dir, "hello"));
    expect(found[0]?.catalogLabel).toBe("test-cat");
    expect(found[0]?.frontmatter["description"]).toBe("Greets the user.");
  });

  test("finds multiple skills sorted by name", async () => {
    await mkSkill("zeta", "---\nname: zeta\ndescription: z.\n---\n");
    await mkSkill("alpha", "---\nname: alpha\ndescription: a.\n---\n");
    await mkSkill("mid", "---\nname: mid\ndescription: m.\n---\n");
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  test("skips subdirs without SKILL.md silently", async () => {
    await mkdir(join(dir, "empty-dir"), { recursive: true });
    await mkSkill("real", "---\nname: real\ndescription: r.\n---\n");
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["real"]);
  });

  test("parses frontmatter as a record — top-level scalars and nested objects round-trip", async () => {
    await mkSkill(
      "complex",
      "---\nname: complex\ndescription: c.\nflag: true\nnested:\n  key: value\n  list:\n    - a\n    - b\n---\nbody\n",
    );
    const found = await discoverSkills(catalog);
    expect(found[0]?.frontmatter["flag"]).toBe(true);
    expect(found[0]?.frontmatter["nested"]).toEqual({ key: "value", list: ["a", "b"] });
  });

  test("tolerates skills whose dirname does NOT match frontmatter name", async () => {
    await mkSkill("named-frontmatter", "---\nname: named-frontmatter\ndescription: d.\n---\n", {
      dirname: "different-dirname",
    });
    const found = await discoverSkills(catalog);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("named-frontmatter");
  });

  test("throws SmithError(validation-failed) on a SKILL.md whose frontmatter is not valid YAML — error names the file", async () => {
    await mkSkill("bad", "---\n: ::: not yaml :::\n---\n");
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("SKILL.md frontmatter");
      expect(payload.reasons[0]).toContain("bad/SKILL.md");
      expect(payload.reasons[0]).toContain("invalid YAML");
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
  });

  test("throws SmithError(validation-failed) on a SKILL.md missing the YAML frontmatter delimiters", async () => {
    await mkSkill("nofm", "no delimiters here\n");
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("SKILL.md frontmatter");
      expect(payload.reasons[0]).toContain("missing YAML frontmatter delimiters");
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
  });

  test("throws SmithError(validation-failed) when frontmatter.name fails validateSkillName — names file and bad name", async () => {
    await mkSkill("Upper", "---\nname: Upper\ndescription: x.\n---\n");
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("SKILL.md frontmatter");
      expect(payload.reasons[0]).toContain("Upper");
      expect(payload.reasons[0]).toContain("invalid skill name");
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
  });

  test("throws SmithError(validation-failed) when frontmatter is missing required name", async () => {
    await mkSkill("noname", "---\ndescription: x.\n---\n");
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("validation-failed");
  });

  test("throws SmithError(validation-failed) when frontmatter is missing required description", async () => {
    await mkSkill("nodesc", "---\nname: nodesc\n---\n");
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("SKILL.md frontmatter");
      expect(payload.reasons[0]).toContain("description");
    } else {
      throw new Error(`expected validation-failed, got ${payload.code}`);
    }
  });

  test("truncates very long descriptions to <=1000 chars with an ellipsis suffix", async () => {
    const longDesc = "x".repeat(5000);
    await mkSkill("longdesc", `---\nname: longdesc\ndescription: ${longDesc}\n---\nbody\n`);
    const found = await discoverSkills(catalog);
    expect(found).toHaveLength(1);
    const desc = found[0]?.frontmatter["description"] as string;
    expect(desc.length).toBeLessThanOrEqual(1000);
    expect(desc.endsWith("…")).toBe(true);
  });

  test("does NOT truncate descriptions at exactly the 1000-char threshold", async () => {
    const desc = "y".repeat(1000);
    await mkSkill("edge", `---\nname: edge\ndescription: ${desc}\n---\n`);
    const found = await discoverSkills(catalog);
    expect(found[0]?.frontmatter["description"]).toBe(desc);
  });

  test("follows a symlinked skill directory and discovers its SKILL.md", async () => {
    // Create the real skill in a sibling tmp dir, then symlink it into the
    // catalog root. discoverSkills should resolve the link and treat it as a
    // directory candidate.
    const externalDir = await mkdtemp(join(tmpdir(), "smith-skill-ext-"));
    try {
      const realSkillDir = join(externalDir, "linked-skill");
      await mkdir(realSkillDir, { recursive: true });
      await writeFile(
        join(realSkillDir, "SKILL.md"),
        "---\nname: linked-skill\ndescription: via symlink.\n---\n",
      );
      await symlink(realSkillDir, join(dir, "linked-skill"));
      const found = await discoverSkills(catalog);
      expect(found.map((s) => s.name)).toContain("linked-skill");
    } finally {
      await rm(externalDir, { recursive: true, force: true });
    }
  });

  test("skips broken symlinks without crashing", async () => {
    await symlink(join(dir, "does-not-exist"), join(dir, "broken"));
    await mkSkill("real", "---\nname: real\ndescription: r.\n---\n");
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["real"]);
  });

  test("handles circular symlinks (A -> B -> A) without infinite loop", async () => {
    // Two symlinks pointing at each other: neither resolves to a directory
    // with a SKILL.md, so both must be skipped after the cycle is detected.
    await symlink(join(dir, "b"), join(dir, "a"));
    await symlink(join(dir, "a"), join(dir, "b"));
    await mkSkill("real", "---\nname: real\ndescription: r.\n---\n");
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["real"]);
  });

  test("propagates non-ENOENT readdir fs errors as SmithError(permission-denied) via classifyFsError", async () => {
    // Synthesize an EACCES from readdir to exercise the non-ENOENT
    // re-throw path. ENOENT is short-circuited (returns []), so this
    // covers what previously was a raw `throw err` re-throw.
    const eaccesErr = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const spy = spyOn(fsPromises, "readdir").mockRejectedValueOnce(eaccesErr);
    let caught: unknown = null;
    try {
      await discoverSkills(catalog);
    } catch (err) {
      caught = err;
    }
    spy.mockRestore();
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "permission-denied") {
      expect(payload.operation).toBe("read");
      expect(payload.path).toBe(dir);
    } else {
      throw new Error(`expected permission-denied, got ${payload.code}`);
    }
  });
});

describe("io/skill-discovery — discoverSkills recursive", () => {
  test("discovers skills nested under a subdirectory (e.g. skills/<name>/SKILL.md)", async () => {
    await mkdir(join(dir, "skills", "alpha"), { recursive: true });
    await mkdir(join(dir, "skills", "beta"), { recursive: true });
    await writeFile(
      join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Alpha skill.\n---\n",
    );
    await writeFile(
      join(dir, "skills", "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Beta skill.\n---\n",
    );
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["alpha", "beta"]);
  });

  test("does NOT descend into a skill directory — nested references/SKILL.md is not a separate skill", async () => {
    await mkdir(join(dir, "skills", "alpha", "references"), { recursive: true });
    await writeFile(
      join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Alpha skill.\n---\n",
    );
    await writeFile(
      join(dir, "skills", "alpha", "references", "SKILL.md"),
      "---\nname: fake-nested\ndescription: Should not be found.\n---\n",
    );
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["alpha"]);
  });

  test("skips .git and node_modules directories during recursion", async () => {
    await mkdir(join(dir, ".git", "hooks"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(dir, ".git", "SKILL.md"),
      "---\nname: git-skill\ndescription: hidden.\n---\n",
    );
    await writeFile(
      join(dir, "node_modules", "SKILL.md"),
      "---\nname: nm-skill\ndescription: hidden.\n---\n",
    );
    await mkdir(join(dir, "real"), { recursive: true });
    await writeFile(
      join(dir, "real", "SKILL.md"),
      "---\nname: real\ndescription: Real skill.\n---\n",
    );
    const found = await discoverSkills(catalog);
    expect(found.map((s) => s.name)).toEqual(["real"]);
  });
});

describe("io/skill-discovery — validateSkillName", () => {
  test("accepts lowercase-alphanumeric-hyphens", () => {
    expect(validateSkillName("jira-helper")).toBe(true);
    expect(validateSkillName("hello-world")).toBe(true);
    expect(validateSkillName("a")).toBe(true);
  });

  test("accepts a name beginning with a digit (looser than agent regex)", () => {
    expect(validateSkillName("3d-modeling")).toBe(true);
    expect(validateSkillName("2024-recap")).toBe(true);
  });

  test("rejects uppercase, spaces, leading/trailing hyphens, names >64 chars, empty string", () => {
    expect(validateSkillName("Upper")).toBe(false);
    expect(validateSkillName("has space")).toBe(false);
    expect(validateSkillName("-leading")).toBe(false);
    expect(validateSkillName("trailing-")).toBe(false);
    expect(validateSkillName("")).toBe(false);
    expect(validateSkillName("a".repeat(65))).toBe(false);
    expect(validateSkillName(123)).toBe(false);
  });
});

describe("io/skill-discovery — resolveAdHocSource typed errors", () => {
  test("throws SmithError(usage-error) when ref is not a local path (e.g. git URL)", async () => {
    let caught: unknown = null;
    try {
      await resolveAdHocSource("https://github.com/foo/bar.git");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "usage-error") {
      expect(payload.message).toContain("https://github.com/foo/bar.git");
      expect(payload.message).toContain("not a local path");
    } else {
      throw new Error(`expected usage-error, got ${payload.code}`);
    }
  });

  test("throws SmithError(not-found) when ref points to a missing directory", async () => {
    const missing = join(tmpdir(), "smith-skill-missing-xyz-doesnotexist-123");
    let caught: unknown = null;
    try {
      await resolveAdHocSource(missing);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    if (payload.code === "not-found") {
      expect(payload.what).toBe("ad-hoc skill source");
      expect(payload.identifier).toBe(missing);
    } else {
      throw new Error(`expected not-found, got ${payload.code}`);
    }
  });

  test("throws SmithError(not-found) when ref dir exists but has no SKILL.md", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-adhoc-no-skill-"));
    try {
      let caught: unknown = null;
      try {
        await resolveAdHocSource(tmp);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      if (payload.code === "not-found") {
        expect(payload.what).toBe("SKILL.md");
        expect(payload.identifier).toBe(join(tmp, "SKILL.md"));
      } else {
        throw new Error(`expected not-found, got ${payload.code}`);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("throws SmithError(validation-failed) when frontmatter name is invalid", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "smith-adhoc-bad-name-"));
    try {
      const skillDir = join(tmp, "bad-skill");
      await mkdir(skillDir);
      await writeFile(join(skillDir, "SKILL.md"), "---\nname: BadName\ndescription: x.\n---\nbody");
      let caught: unknown = null;
      try {
        await resolveAdHocSource(skillDir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmithError);
      const payload = (caught as SmithError).payload;
      if (payload.code === "validation-failed") {
        expect(payload.what).toBe("SKILL.md frontmatter");
        expect(payload.reasons[0]).toContain("BadName");
      } else {
        throw new Error(`expected validation-failed, got ${payload.code}`);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
