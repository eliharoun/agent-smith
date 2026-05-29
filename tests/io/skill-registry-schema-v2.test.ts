import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultSkillRegistry,
  loadSkillRegistry,
  saveSkillRegistry,
  type SkillRegistry,
} from "../../src/io/skill-registry";

async function withTmp(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "skill-registry-v2-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SkillRegistry schemaVersion: 2 [v1-task C3.7]", () => {
  test("defaultSkillRegistry emits schemaVersion: 2", () => {
    const reg = defaultSkillRegistry();
    expect(reg.schemaVersion).toBe(2);
  });

  test("loads schemaVersion: 2 with a remote block on a catalog", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 2,
          catalogs: [
            {
              kind: "team-shared",
              rootPath: "/tmp/x",
              label: "x",
              remote: {
                url: "https://github.com/foo/bar.git",
                ref: "main",
                lastPulledSha: "a".repeat(40),
                lastPulledAt: "2026-05-24T00:00:00.000Z",
                lastRemoteSha: "a".repeat(40),
                lastCheckedAt: "2026-05-24T00:01:00.000Z",
              },
            },
          ],
        }),
        "utf-8",
      );
      const reg = await loadSkillRegistry(path);
      expect(reg.schemaVersion).toBe(2);
      const teamShared = reg.catalogs.find((c) => c.label === "x");
      expect(teamShared?.remote?.url).toBe("https://github.com/foo/bar.git");
      expect(teamShared?.remote?.ref).toBe("main");
    });
  });

  test("migrates schemaVersion: 1 on disk to v2 in-memory", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 1,
          catalogs: [{ kind: "user-global", rootPath: "/tmp/z", label: "z" }],
        }),
        "utf-8",
      );
      const reg = await loadSkillRegistry(path);
      expect(reg.schemaVersion).toBe(2);
    });
  });

  test("migrates legacy 'version: 1' to v2", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({ version: 1, catalogs: [] }),
        "utf-8",
      );
      const reg = await loadSkillRegistry(path);
      expect(reg.schemaVersion).toBe(2);
    });
  });

  test("rejects legacy 'version: 2' (version field is v1-only)", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({ version: 2, catalogs: [] }),
        "utf-8",
      );
      await expect(loadSkillRegistry(path)).rejects.toThrow();
    });
  });

  test("rejects malformed remote.url (empty string)", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 2,
          catalogs: [
            {
              kind: "team-shared",
              rootPath: "/tmp/x",
              label: "x",
              remote: { url: "", ref: "main" },
            },
          ],
        }),
        "utf-8",
      );
      await expect(loadSkillRegistry(path)).rejects.toThrow();
    });
  });

  test("preserves adhoc / protected flags through v1→v2 migration", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 1,
          catalogs: [
            {
              kind: "user-global",
              rootPath: "/tmp/z",
              label: "z",
              adhoc: true,
              protected: false,
            },
          ],
        }),
        "utf-8",
      );
      const reg = await loadSkillRegistry(path);
      const z = reg.catalogs.find((c) => c.label === "z");
      expect(z?.adhoc).toBe(true);
    });
  });

  test("save+load roundtrip preserves remote block and emits schemaVersion: 2", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "skill-catalogs.json");
      const reg: SkillRegistry = {
        schemaVersion: 2,
        catalogs: [
          {
            kind: "team-shared",
            rootPath: "/tmp/rt",
            label: "rt",
            gitRemote: "https://github.com/foo/bar.git",
            remote: {
              url: "https://github.com/foo/bar.git",
              ref: "main",
              lastPulledSha: "c".repeat(40),
            },
          },
        ],
      };
      await saveSkillRegistry(path, reg);
      const onDisk = JSON.parse(await Bun.file(path).text());
      expect(onDisk.schemaVersion).toBe(2);
      const loaded = await loadSkillRegistry(path);
      const rt = loaded.catalogs.find((c) => c.label === "rt");
      expect(rt?.remote?.lastPulledSha).toBe("c".repeat(40));
    });
  });
});
