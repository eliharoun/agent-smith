import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalConfig } from "../../src/core/types";
import { checkSkillAvailability } from "../../src/io/skill-availability";

let tmp: string;
let sourceRoot: string;
let opencodeSkills: string;
let claudeSkills: string;
let codexSkills: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "smith-skills-"));
  sourceRoot = join(tmp, "agents");
  opencodeSkills = join(tmp, "opencode-skills");
  claudeSkills = join(tmp, "claude-skills");
  codexSkills = join(tmp, "codex-skills");
  await mkdir(sourceRoot, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const baseConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "x",
  description: "Reviews things",
  targets: ["opencode", "claude-code", "codex"],
  modelTier: "balanced",
};

const paths = (): {
  sourceRoots: string[];
  opencodeSkillsDir: string;
  claudeSkillsDir: string;
  codexSkillsDir: string;
} => ({
  sourceRoots: [sourceRoot],
  opencodeSkillsDir: opencodeSkills,
  claudeSkillsDir: claudeSkills,
  codexSkillsDir: codexSkills,
});

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`,
  );
}

describe("io/skill-availability", () => {
  test("returns no warnings when skills is absent", async () => {
    const r = await checkSkillAvailability(baseConfig, paths());
    expect(r.warnings).toEqual([]);
    expect(r.descriptions.size).toBe(0);
  });

  test("returns no warnings when skills is empty", async () => {
    const r = await checkSkillAvailability({ ...baseConfig, skills: [] }, paths());
    expect(r.warnings).toEqual([]);
  });

  test("finds skill in source root and reads description", async () => {
    // Skill present in source root AND in opencode install dir -> no warnings.
    await writeSkill(sourceRoot, "alpha", "Use alpha when alphas happen");
    await writeSkill(opencodeSkills, "alpha", "Use alpha when alphas happen");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["alpha"], targets: ["opencode"] },
      paths(),
    );
    expect(r.warnings).toEqual([]);
    expect(r.descriptions.get("alpha")).toBe("Use alpha when alphas happen");
  });

  test("finds skill only in claude-code install dir; warns for missing opencode/codex install dirs", async () => {
    await writeSkill(claudeSkills, "beta", "Use beta carefully");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["beta"], targets: ["opencode", "claude-code", "codex"] },
      paths(),
    );
    expect(r.descriptions.get("beta")).toBe("Use beta carefully");
    expect(r.warnings).toContain("skill 'beta' not installed for opencode");
    expect(r.warnings).toContain("skill 'beta' not installed for codex");
    expect(r.warnings).not.toContain("skill 'beta' not installed for claude-code");
  });

  test("warns once when skill is not found anywhere", async () => {
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["nonexistent"], targets: ["opencode"] },
      paths(),
    );
    expect(r.warnings).toContain(
      "skill 'nonexistent' not found in any agent-smith source or platform skill dir",
    );
    expect(r.warnings).not.toContain("skill 'nonexistent' not installed for opencode");
  });

  test("finding skill in source root suppresses 'not found' but still warns per missing target dir", async () => {
    await writeSkill(sourceRoot, "gamma", "Use gamma");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["gamma"], targets: ["opencode", "claude-code"] },
      paths(),
    );
    expect(r.warnings).not.toContain(
      "skill 'gamma' not found in any agent-smith source or platform skill dir",
    );
    expect(r.warnings).toContain("skill 'gamma' not installed for opencode");
    expect(r.warnings).toContain("skill 'gamma' not installed for claude-code");
    expect(r.descriptions.get("gamma")).toBe("Use gamma");
  });

  test("description precedence: source root wins over platform install dirs", async () => {
    await writeSkill(sourceRoot, "delta", "Source description");
    await writeSkill(opencodeSkills, "delta", "OpenCode description");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["delta"], targets: ["opencode"] },
      paths(),
    );
    expect(r.descriptions.get("delta")).toBe("Source description");
  });

  test("description precedence: opencode dir wins over claude/codex dirs when source missing", async () => {
    await writeSkill(opencodeSkills, "epsilon", "OpenCode description");
    await writeSkill(claudeSkills, "epsilon", "Claude description");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["epsilon"], targets: ["opencode", "claude-code"] },
      paths(),
    );
    expect(r.descriptions.get("epsilon")).toBe("OpenCode description");
  });

  test("missing description in SKILL.md frontmatter results in no descriptions entry, but skill is still 'found'", async () => {
    const dir = join(sourceRoot, "zeta");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: zeta\n---\n\nbody\n");
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["zeta"], targets: ["opencode"] },
      paths(),
    );
    expect(r.warnings).not.toContain(
      "skill 'zeta' not found in any agent-smith source or platform skill dir",
    );
    expect(r.descriptions.has("zeta")).toBe(false);
  });

  test("source-roots iteration handles non-existent root paths silently", async () => {
    const r = await checkSkillAvailability(
      { ...baseConfig, skills: ["alpha"], targets: ["opencode"] },
      {
        sourceRoots: [join(tmp, "does-not-exist")],
        opencodeSkillsDir: opencodeSkills,
        claudeSkillsDir: claudeSkills,
        codexSkillsDir: codexSkills,
      },
    );
    expect(r.warnings).toContain(
      "skill 'alpha' not found in any agent-smith source or platform skill dir",
    );
  });
});
