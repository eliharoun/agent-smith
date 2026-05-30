import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSkillCli } from "./validate";

let home: string;
let catalogRoot: string;

async function writeSkill(name: string, frontmatter: string, body = "# body\n") {
  const dir = join(catalogRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}---\n\n${body}`);
}

async function writeRegistry() {
  await mkdir(join(home, ".config", "agent-smith"), { recursive: true });
  await writeFile(
    join(home, ".config", "agent-smith", "skill-catalogs.json"),
    JSON.stringify(
      {
        version: 1,
        catalogs: [{ kind: "user-local", rootPath: catalogRoot, label: "test-cat" }],
      },
      null,
      2,
    ),
  );
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "smith-skill-validate-"));
  catalogRoot = join(home, "catalog");
  await mkdir(catalogRoot, { recursive: true });
  await writeRegistry();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("validateSkillCli", () => {
  it("returns 0 and prints ok on valid skill", async () => {
    await writeSkill("good", "name: good\ndescription: a fine skill\n");
    const lines: string[] = [];
    const code = await validateSkillCli({
      name: "good",
      homeDirOverride: home,
      print: (m) => lines.push(m),
      printErr: (m) => lines.push(`ERR ${m}`),
    });
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("PASS") && l.includes("good"))).toBe(true);
  });

  it("returns 1 when skill not found", async () => {
    const lines: string[] = [];
    const code = await validateSkillCli({
      name: "missing",
      homeDirOverride: home,
      print: (m) => lines.push(m),
      printErr: (m) => lines.push(`ERR ${m}`),
    });
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes("ERR") && l.includes("not found"))).toBe(true);
  });

  it("returns 2 when frontmatter is invalid", async () => {
    // Missing description — discoverSkills throws SmithError("validation-failed")
    await writeSkill("bad", "name: bad\n");
    const lines: string[] = [];
    const code = await validateSkillCli({
      name: "bad",
      homeDirOverride: home,
      print: (m) => lines.push(m),
      printErr: (m) => lines.push(`ERR ${m}`),
    });
    expect(code).toBe(2);
    expect(lines.some((l) => l.includes("ERR") && l.includes("description"))).toBe(true);
  });

  it("returns 2 when name appears in two catalogs (ambiguous)", async () => {
    await writeSkill("dup", "name: dup\ndescription: x\n");
    const other = join(home, "catalog2");
    await mkdir(join(other, "dup"), { recursive: true });
    await writeFile(
      join(other, "dup", "SKILL.md"),
      `---\nname: dup\ndescription: y\n---\n\n# b\n`,
    );
    await writeFile(
      join(home, ".config", "agent-smith", "skill-catalogs.json"),
      JSON.stringify(
        {
          version: 1,
          catalogs: [
            { kind: "user-local", rootPath: catalogRoot, label: "test-cat" },
            { kind: "user-local", rootPath: other, label: "other-cat" },
          ],
        },
        null,
        2,
      ),
    );
    const lines: string[] = [];
    const code = await validateSkillCli({
      name: "dup",
      homeDirOverride: home,
      print: (m) => lines.push(m),
      printErr: (m) => lines.push(`ERR ${m}`),
    });
    expect(code).toBe(2);
    expect(lines.some((l) => l.includes("ambiguous"))).toBe(true);
  });
});
