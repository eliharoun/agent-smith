import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkillBundle } from "./scan-skill-bundle";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skill-bundle-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scanSkillBundle", () => {
  it("parses frontmatter, body, and resources", async () => {
    await writeFile(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\nthe body\n");
    await mkdir(join(dir, "references"));
    await writeFile(join(dir, "references", "a.md"), "hi");
    const detail = await scanSkillBundle({
      path: dir,
      catalogLabel: "L",
      installedOn: ["opencode"],
    });
    expect(detail.name).toBe("x");
    expect(detail.body).toBe("the body\n");
    expect(detail.resources.find((r) => r.relPath === "references/a.md")?.bytes).toBe(2);
    expect(detail.installedOn).toEqual(["opencode"]);
  });

  it("throws when SKILL.md missing frontmatter", async () => {
    await writeFile(join(dir, "SKILL.md"), "no frontmatter");
    await expect(
      scanSkillBundle({ path: dir, catalogLabel: "L", installedOn: [] }),
    ).rejects.toThrow(/missing YAML frontmatter/);
  });
});
