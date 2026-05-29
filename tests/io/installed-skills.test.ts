import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmithError } from "../../src/core/smith-error";
import {
  addInstalledSkill,
  hashSkillDir,
  type InstalledSkill,
  type InstalledSkillsFile,
  loadInstalledSkills,
  removeInstalledSkill,
  saveInstalledSkills,
} from "../../src/io/installed-skills";

let homeDir: string;
beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "installed-skills-"));
});
afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe("loadInstalledSkills", () => {
  test("returns empty default when file does not exist", async () => {
    const file = await loadInstalledSkills({ homeDir });
    expect(file).toEqual({ schemaVersion: 1, installed: [] });
  });

  test("round-trips through saveInstalledSkills", async () => {
    const before: InstalledSkillsFile = {
      schemaVersion: 1,
      installed: [
        {
          name: "jira-helper",
          sourceCatalogLabel: "team",
          sourcePath: "/tmp/x/team/skills/jira-helper",
          installedPaths: {
            opencode: "/tmp/oc/skills/jira-helper",
            claudeCode: "/tmp/cc/skills/jira-helper",
            codex: "/tmp/cx/skills/jira-helper",
          },
          contentHash: "deadbeef",
          installedAt: "2026-05-03T14:00:00.000Z",
        },
      ],
    };
    await saveInstalledSkills(before, { homeDir });
    const after = await loadInstalledSkills({ homeDir });
    expect(after).toEqual(before);
  });

  test("creates ~/.config/agent-smith/ on save if missing", async () => {
    await saveInstalledSkills({ schemaVersion: 1, installed: [] }, { homeDir });
    const raw = await readFile(join(homeDir, ".config/agent-smith/installed-skills.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, installed: [] });
  });

  test("throws SmithError({code:'installed-skills-corrupt'}) on malformed JSON", async () => {
    const p = join(homeDir, ".config/agent-smith/installed-skills.json");
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(p, "{not json");
    const err = await loadInstalledSkills({ homeDir }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("installed-skills-corrupt");
    expect(err.payload.path).toBe(p);
    expect(err.payload.parseError).toBeTruthy();
  });

  test("throws SmithError({code:'installed-skills-corrupt'}) on malformed shape", async () => {
    const p = join(homeDir, ".config/agent-smith/installed-skills.json");
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(p, JSON.stringify({ version: 2, installed: [] }));
    const err = await loadInstalledSkills({ homeDir }).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("installed-skills-corrupt");
    expect(err.payload.path).toBe(p);
    expect(err.payload.parseError).toMatch(/malformed shape/);
  });
});

describe("addInstalledSkill / removeInstalledSkill", () => {
  test("addInstalledSkill appends and is idempotent on name", () => {
    const empty: InstalledSkillsFile = { schemaVersion: 1, installed: [] };
    const entry: InstalledSkill = {
      name: "x",
      sourceCatalogLabel: "team",
      sourcePath: "/s",
      installedPaths: { opencode: "/oc/x" },
      contentHash: "h1",
      installedAt: "2026-05-03T14:00:00.000Z",
    };
    const a = addInstalledSkill(empty, entry);
    expect(a.installed).toHaveLength(1);
    const b = addInstalledSkill(a, { ...entry, contentHash: "h2" });
    expect(b.installed).toHaveLength(1);
    expect(b.installed[0]?.contentHash).toBe("h2"); // update-in-place
  });

  test("removeInstalledSkill drops by name; no-op when not present", () => {
    const f: InstalledSkillsFile = {
      schemaVersion: 1,
      installed: [
        {
          name: "a",
          sourceCatalogLabel: "r",
          sourcePath: "/",
          installedPaths: {},
          contentHash: "h",
          installedAt: "t",
        },
        {
          name: "b",
          sourceCatalogLabel: "r",
          sourcePath: "/",
          installedPaths: {},
          contentHash: "h",
          installedAt: "t",
        },
      ],
    };
    expect(removeInstalledSkill(f, "a").installed.map((e) => e.name)).toEqual(["b"]);
    expect(removeInstalledSkill(f, "missing").installed.map((e) => e.name)).toEqual(["a", "b"]);
  });
});

describe("hashSkillDir", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-hash-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("produces a sha256 hex digest", async () => {
    await writeFile(join(dir, "SKILL.md"), "# hello\n");
    const h = await hashSkillDir(dir);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic across runs", async () => {
    await writeFile(join(dir, "SKILL.md"), "# hello\n");
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts/run.sh"), "#!/bin/sh\n");
    const h1 = await hashSkillDir(dir);
    const h2 = await hashSkillDir(dir);
    expect(h1).toBe(h2);
  });

  test("changes when SKILL.md changes", async () => {
    await writeFile(join(dir, "SKILL.md"), "v1");
    const h1 = await hashSkillDir(dir);
    await writeFile(join(dir, "SKILL.md"), "v2");
    const h2 = await hashSkillDir(dir);
    expect(h1).not.toBe(h2);
  });

  test("changes when a script is added (covers whole-dir requirement Q4)", async () => {
    await writeFile(join(dir, "SKILL.md"), "v1");
    const h1 = await hashSkillDir(dir);
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts/x.sh"), "echo hi");
    const h2 = await hashSkillDir(dir);
    expect(h1).not.toBe(h2);
  });

  test("changes when a nested file under references/ changes", async () => {
    await writeFile(join(dir, "SKILL.md"), "v1");
    await mkdir(join(dir, "references/sub"), { recursive: true });
    await writeFile(join(dir, "references/sub/note.md"), "v1");
    const h1 = await hashSkillDir(dir);
    await writeFile(join(dir, "references/sub/note.md"), "v2");
    const h2 = await hashSkillDir(dir);
    expect(h1).not.toBe(h2);
  });
});

describe("saveInstalledSkills concurrency (IO-24)", () => {
  test("many concurrent saves to the same homeDir all resolve without rejection", async () => {
    // Regression: prior to using atomicWriteJson, the inline implementation
    // used `${path}.tmp.${process.pid}` which collides when two writers
    // race within the same process. One overwrites the other's staged
    // content before either renames; the file may end up partially
    // written or one rename may fail with ENOENT.
    const fileA: InstalledSkillsFile = {
      schemaVersion: 1,
      installed: [
        {
          name: "a",
          sourceCatalogLabel: "x",
          sourcePath: "/tmp/a",
          installedPaths: { opencode: "/tmp/oc/a" },
          contentHash: "a".repeat(64),
          installedAt: "2026-05-06T00:00:00.000Z",
        },
      ],
    };
    const fileB: InstalledSkillsFile = {
      schemaVersion: 1,
      installed: [
        {
          name: "b",
          sourceCatalogLabel: "y",
          sourcePath: "/tmp/b",
          installedPaths: { opencode: "/tmp/oc/b" },
          contentHash: "b".repeat(64),
          installedAt: "2026-05-06T00:00:00.000Z",
        },
      ],
    };
    const writers: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      writers.push(saveInstalledSkills(i % 2 === 0 ? fileA : fileB, { homeDir }));
    }
    await Promise.all(writers); // must not reject

    // Persisted file must be one of the two complete payloads.
    const reloaded = await loadInstalledSkills({ homeDir });
    expect(reloaded.installed).toHaveLength(1);
    expect(["a", "b"]).toContain(reloaded.installed[0]!.name);
  });
});

describe("pathFor (production / no homeDir override)", () => {
  test("honors XDG_CONFIG_HOME for the default path", async () => {
    // Drive `pathFor()` via save+load with NO `homeDir` override, pointing
    // XDG_CONFIG_HOME at the tmpdir. The state file should land at
    // <xdg>/agent-smith/installed-skills.json (NOT <home>/.config/...).
    const prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = homeDir;
    try {
      await saveInstalledSkills({ schemaVersion: 1, installed: [] });
      const raw = await readFile(join(homeDir, "agent-smith/installed-skills.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, installed: [] });
      const reloaded = await loadInstalledSkills();
      expect(reloaded).toEqual({ schemaVersion: 1, installed: [] });
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
    }
  });
});
