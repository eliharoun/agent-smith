import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillCatalogs } from "../../src/cli/commands/skill/catalogs";
import { type SkillRegistry, saveSkillRegistry } from "../../src/io/skill-registry";

let dir: string;
let registryPath: string;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "smith-skill-cats-"));
  registryPath = join(dir, "skill-catalogs.json");
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli/skill catalogs", () => {
  test("prints one line per registered catalog: kind, label, rootPath", async () => {
    const reg: SkillRegistry = {
      schemaVersion: 2,
      catalogs: [
        { kind: "user-global", rootPath: "/tmp/aa", label: "alpha" },
        { kind: "team-shared", rootPath: "/tmp/bb", label: "beta" },
      ],
    };
    await saveSkillRegistry(registryPath, reg);
    const code = await skillCatalogs({ registryPath });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("alpha");
    expect(out).toContain("/tmp/aa");
    expect(out).toContain("user-global");
    expect(out).toContain("beta");
    expect(out).toContain("/tmp/bb");
    expect(out).toContain("team-shared");
  });

  test("marks adhoc catalogs with '(adhoc)'", async () => {
    const reg: SkillRegistry = {
      schemaVersion: 2,
      catalogs: [{ kind: "user-global", rootPath: "/tmp/x", label: "x", adhoc: true }],
    };
    await saveSkillRegistry(registryPath, reg);
    await skillCatalogs({ registryPath });
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("adhoc");
  });

  test("annotates '(not yet cloned)' when rootPath does not exist and gitRemote is set", async () => {
    const reg: SkillRegistry = {
      schemaVersion: 2,
      catalogs: [
        {
          kind: "team-shared",
          rootPath: "/tmp/nonexistent-clone-path",
          label: "atlassian-skills",
          gitRemote: "https://github.com/langpingxue/atlassian-skills.git",
          remote: { url: "https://github.com/langpingxue/atlassian-skills.git", ref: "HEAD" },
          protected: true,
        },
      ],
    };
    await saveSkillRegistry(registryPath, reg);
    await skillCatalogs({ registryPath });
    const out = logSpy.mock.calls.flat().join(" ");
    expect(out).toContain("not yet cloned");
    expect(out).toContain("atlassian-skills");
    expect(out).toContain("protected");
  });

  test("does NOT annotate '(not yet cloned)' when rootPath exists", async () => {
    const reg: SkillRegistry = {
      schemaVersion: 2,
      catalogs: [
        {
          kind: "team-shared",
          rootPath: dir,
          label: "local-cat",
          gitRemote: "https://example.com/repo.git",
        },
      ],
    };
    await saveSkillRegistry(registryPath, reg);
    await skillCatalogs({ registryPath });
    // Find the line for local-cat specifically (other injected catalogs may show "not yet cloned")
    const lines = logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(" "));
    const localCatLine = lines.find((l: string) => l.includes("local-cat"));
    expect(localCatLine).toBeDefined();
    expect(localCatLine).not.toContain("not yet cloned");
  });
});
