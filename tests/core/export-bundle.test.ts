import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBundle } from "../../src/core/export-bundle";
import { ExportManifestSchema } from "../../src/core/export-manifest";
import { readArchive } from "../../src/io/archive-tar";

const FIXTURE_MINIMAL = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");

describe("exportBundle — minimal bundle", () => {
  test("produces a valid archive with a parseable manifest", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const entries = await readArchive(result.archive!);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("minimal-bundle/agent.config.json");
    expect(paths).toContain("minimal-bundle/IDENTITY.md");
    expect(paths).toContain("minimal-bundle/EXPERTISE.md");
    expect(paths).toContain("minimal-bundle/SOUL.md");
    expect(paths).toContain("minimal-bundle/USER.md");
    expect(paths).toContain("minimal-bundle/_smith-export.json");
    expect(paths).toContain("minimal-bundle/README.md");

    const manifestEntry = entries.find((e) => e.path === "minimal-bundle/_smith-export.json")!;
    const manifest = ExportManifestSchema.parse(JSON.parse(manifestEntry.bytes.toString()));
    expect(manifest.bundle.name).toBe("minimal-bundle");
    expect(manifest.producedBy.smithVersion).toBe("1.7.0");
    expect(manifest.requires.skills).toEqual([]);
    expect(manifest.requires.remoteKnowledge).toEqual([]);
    // userAgent must not embed process.platform to keep cross-OS output identical.
    expect(manifest.producedBy.userAgent).toBe("smith-cli/1.7.0");
    // The self-entry uses a zero placeholder so recipients can skip its hash check.
    const selfEntry = manifest.contents.files.find((f) => f.path.endsWith("/_smith-export.json"));
    expect(selfEntry).toBeDefined();
    expect(selfEntry?.size).toBe(0);
    expect(selfEntry?.sha256).toBe("0".repeat(64));
  });

  test("USER.md ships as a stub", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const entries = await readArchive(result.archive!);
    const userMd = entries.find((e) => e.path === "minimal-bundle/USER.md")!;
    expect(userMd.bytes.toString()).toBe("# USER context\n\nThis file is a placeholder.\n");
  });

  test("re-exporting the same input yields byte-identical archives", async () => {
    const opts = {
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub" as const,
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    };
    const a = await exportBundle(opts);
    const b = await exportBundle(opts);
    expect(a.archive!.equals(b.archive!)).toBe(true);
    expect(a.contentHash).toBe(b.contentHash);
  });
});

async function makeTempBundle(name: string, configExtra: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "export-portcheck-"));
  await writeFile(
    join(dir, "agent.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name,
      description: "Use proactively as a portability-test fixture.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "subagent",
      ...configExtra,
    }),
    "utf8",
  );
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(dir, f), "placeholder\n", "utf8");
  }
  return dir;
}

const FIXTURE_LOCAL_K = join(import.meta.dir, "..", "_fixtures", "export-bundle-with-local-knowledge");

describe("exportBundle — local knowledge", () => {
  test("packs files referenced by type: dir", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_LOCAL_K,
      bundleName: "local-knowledge-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const entries = await readArchive(result.archive!);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("local-knowledge-bundle/notes/intro.md");
  });

  test("re-export with local knowledge yields byte-identical archives", async () => {
    const opts = {
      bundlePath: FIXTURE_LOCAL_K,
      bundleName: "local-knowledge-bundle",
      includeSkills: false,
      userMdPolicy: "stub" as const,
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    };
    const a = await exportBundle(opts);
    const b = await exportBundle(opts);
    expect(a.archive!.equals(b.archive!)).toBe(true);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test("does not duplicate README.md when knowledge declares it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-readme-dedup-"));
    try {
      await writeFile(
        join(dir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "readme-dedup",
          description: "Test that README.md is not duplicated.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
          knowledge: {
            sources: [
              { id: "r", type: "file", delivery: "file", path: "README.md" },
            ],
          },
        }),
        "utf8",
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
        await writeFile(join(dir, f), "placeholder\n", "utf8");
      }
      // Create a README.md that knowledge would pack if not blocked.
      await writeFile(join(dir, "README.md"), "# pre-existing readme\n", "utf8");
      const result = await exportBundle({
        bundlePath: dir,
        bundleName: "readme-dedup",
        includeSkills: false,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-03T15:00:00Z"),
        smithVersion: "1.7.0",
      });
      const entries = await readArchive(result.archive!);
      const readmeEntries = entries.filter((e) => e.path.endsWith("/README.md"));
      // Exactly one README.md: the export-generated one, not a duplicate from knowledge.
      expect(readmeEntries).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("exportBundle — portability checks", () => {
  test("refuses absolute paths in knowledge sources", async () => {
    const dir = await makeTempBundle("portcheck-abs", {
      knowledge: { sources: [{ id: "x", type: "file", delivery: "file", path: "/etc/hosts" }] },
    });
    try {
      await expect(
        exportBundle({
          bundlePath: dir,
          bundleName: "portcheck-abs",
          includeSkills: false,
          userMdPolicy: "stub",
          now: () => new Date("2026-06-03T15:00:00Z"),
          smithVersion: "1.7.0",
        }),
      ).rejects.toMatchObject({
        payload: {
          code: "validation-failed",
          what: "knowledge source path",
          reasons: [expect.stringMatching(/absolute path/)],
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses paths escaping the bundle dir", async () => {
    const dir = await makeTempBundle("portcheck-escape", {
      knowledge: { sources: [{ id: "y", type: "dir", delivery: "file", path: "../../etc" }] },
    });
    try {
      await expect(
        exportBundle({
          bundlePath: dir,
          bundleName: "portcheck-escape",
          includeSkills: false,
          userMdPolicy: "stub",
          now: () => new Date("2026-06-03T15:00:00Z"),
          smithVersion: "1.7.0",
        }),
      ).rejects.toMatchObject({
        payload: {
          code: "validation-failed",
          what: "knowledge source path",
          reasons: [expect.stringMatching(/outside the bundle directory/)],
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const FIXTURE_WITH_SKILL = join(import.meta.dir, "..", "_fixtures", "export-bundle-with-skill");
const FIXTURE_SKILL_DIR = join(import.meta.dir, "..", "_fixtures", "export-skill");

describe("exportBundle — skill embedding", () => {
  test("embeds the skill source dir when includeSkills=true", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_WITH_SKILL,
      bundleName: "with-skill-bundle",
      includeSkills: true,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
      resolveSkill: async (name) => {
        if (name === "fixture-skill") return join(FIXTURE_SKILL_DIR, "fixture-skill");
        return null;
      },
    });
    const entries = await readArchive(result.archive!);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("with-skill-bundle/skills/fixture-skill/SKILL.md");
    expect(result.manifest.requires.skills).toEqual([
      { name: "fixture-skill", embedded: true },
    ]);
    expect(result.manifest.omitted.skills).toEqual([]);
  });

  test("declares but does not embed when includeSkills=false", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_WITH_SKILL,
      bundleName: "with-skill-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-03T15:00:00Z"),
      smithVersion: "1.7.0",
    });
    const entries = await readArchive(result.archive!);
    const paths = entries.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("with-skill-bundle/skills/"))).toBe(false);
    expect(result.manifest.requires.skills).toEqual([
      { name: "fixture-skill", embedded: false },
    ]);
    expect(result.manifest.omitted.skills).toEqual(["fixture-skill"]);
  });

  test("refuses export when includeSkills=true but a skill cannot be resolved", async () => {
    await expect(
      exportBundle({
        bundlePath: FIXTURE_WITH_SKILL,
        bundleName: "with-skill-bundle",
        includeSkills: true,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-03T15:00:00Z"),
        smithVersion: "1.7.0",
        resolveSkill: async () => null,
      }),
    ).rejects.toThrow();
  });
});

describe("exportBundle — symlink rejection", () => {
  test("refuses to pack a symlinked knowledge file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-symlink-"));
    const targetDir = await mkdtemp(join(tmpdir(), "export-symlink-target-"));
    try {
      await writeFile(join(targetDir, "secret.txt"), "secret content");
      await writeFile(
        join(dir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "symlink-test",
          description: "Use proactively as a symlink-test fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
          knowledge: { sources: [{ id: "leak", type: "file", delivery: "file", path: "leak.txt" }] },
        }),
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
        await writeFile(join(dir, f), "placeholder\n");
      }
      await symlink(join(targetDir, "secret.txt"), join(dir, "leak.txt"));
      await expect(
        exportBundle({
          bundlePath: dir,
          bundleName: "symlink-test",
          includeSkills: false,
          userMdPolicy: "stub",
          now: () => new Date("2026-06-04T15:00:00Z"),
          smithVersion: "1.7.0",
        }),
      ).rejects.toMatchObject({
        payload: {
          code: "validation-failed",
          what: "knowledge source path",
          reasons: [expect.stringMatching(/symlink/)],
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});

describe("exportBundle — compression option", () => {
  test("compression: 'none' produces uncompressed tar", async () => {
    const r = await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-04T15:00:00Z"),
      smithVersion: "1.7.0",
      compression: "none",
    });
    // Bare tar starts with the file's name (ASCII), gzipped tar starts with 0x1f 0x8b.
    expect(r.archive![0]).not.toBe(0x1f);
  });
});

describe("exportBundle — USER.md policies", () => {
  test("keep policy ships the existing content verbatim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-usermd-keep-"));
    try {
      await writeFile(
        join(dir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "usermd-keep",
          description: "Use proactively as a USER.md keep test fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
        }),
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md"]) {
        await writeFile(join(dir, f), "placeholder\n");
      }
      const customUserMd = "# Custom USER\n\nProducer-specific context.\n";
      await writeFile(join(dir, "USER.md"), customUserMd);
      const result = await exportBundle({
        bundlePath: dir,
        bundleName: "usermd-keep",
        includeSkills: false,
        userMdPolicy: "keep",
        now: () => new Date("2026-06-04T15:00:00Z"),
        smithVersion: "1.7.0",
      });
      const entries = await readArchive(result.archive!);
      const userEntry = entries.find((e) => e.path === "usermd-keep/USER.md");
      expect(userEntry?.bytes.toString()).toBe(customUserMd);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reject policy throws when USER.md is a symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-usermd-reject-symlink-"));
    const target = await mkdtemp(join(tmpdir(), "export-usermd-reject-target-"));
    try {
      await writeFile(
        join(dir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "usermd-reject-symlink",
          description: "Use proactively as a USER.md reject-on-symlink fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
        }),
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md"]) {
        await writeFile(join(dir, f), "placeholder\n");
      }
      await writeFile(join(target, "user-source.md"), "# linked\n");
      await symlink(join(target, "user-source.md"), join(dir, "USER.md"));
      await expect(
        exportBundle({
          bundlePath: dir,
          bundleName: "usermd-reject-symlink",
          includeSkills: false,
          userMdPolicy: "reject",
          now: () => new Date("2026-06-04T15:00:00Z"),
          smithVersion: "1.7.0",
        }),
      ).rejects.toMatchObject({
        payload: { code: "validation-failed", what: "USER.md" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  test("reject policy throws when USER.md has non-stub content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-usermd-reject-content-"));
    try {
      await writeFile(
        join(dir, "agent.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "usermd-reject-content",
          description: "Use proactively as a USER.md reject-on-content fixture.",
          targets: ["claude-code"],
          modelTier: "balanced",
          mode: "subagent",
        }),
      );
      for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md"]) {
        await writeFile(join(dir, f), "placeholder\n");
      }
      await writeFile(join(dir, "USER.md"), "# Not the canonical stub\n");
      await expect(
        exportBundle({
          bundlePath: dir,
          bundleName: "usermd-reject-content",
          includeSkills: false,
          userMdPolicy: "reject",
          now: () => new Date("2026-06-04T15:00:00Z"),
          smithVersion: "1.7.0",
        }),
      ).rejects.toMatchObject({
        payload: { code: "validation-failed", what: "USER.md" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("exportBundle — remote knowledge declarations", () => {
  test("manifest lists url sources by domain", async () => {
    const dir = await makeTempBundle("remote-decl", {
      knowledge: {
        sources: [
          {
            id: "wiki",
            type: "url",
            delivery: "file",
            url: "https://wiki.example.com/space/page",
          },
        ],
      },
    });
    try {
      const result = await exportBundle({
        bundlePath: dir,
        bundleName: "remote-decl",
        includeSkills: false,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-03T15:00:00Z"),
        smithVersion: "1.7.0",
      });
      expect(result.manifest.requires.remoteKnowledge).toEqual([
        { id: "wiki", type: "url", endpoint: "wiki.example.com" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("confluence sources are flagged as needing atlassian credentials", async () => {
    const dir = await makeTempBundle("conf-decl", {
      knowledge: {
        sources: [
          {
            id: "space-x",
            type: "confluence",
            delivery: "file",
            baseUrl: "https://acme.atlassian.net",
            spaceKey: "X",
          },
        ],
      },
    });
    try {
      const result = await exportBundle({
        bundlePath: dir,
        bundleName: "conf-decl",
        includeSkills: false,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-03T15:00:00Z"),
        smithVersion: "1.7.0",
      });
      expect(result.manifest.requires.credentials).toEqual([
        {
          kind: "atlassian",
          reason: expect.stringContaining("confluence"),
          docPath: expect.stringContaining("15-sharing"),
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
