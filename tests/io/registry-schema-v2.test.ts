import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultRegistry,
  loadRegistry,
  type Registry,
  saveRegistry,
} from "../../src/io/registry";

async function withTmp(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "registry-v2-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Registry schemaVersion: 2 [v1-task C3.6]", () => {
  test("default registry emits schemaVersion: 2", () => {
    const reg = defaultRegistry();
    expect(reg.schemaVersion).toBe(2);
  });

  test("loads schemaVersion: 2 with a remote block on a source", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      const raw = {
        schemaVersion: 2,
        sources: [
          {
            kind: "registered",
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
      };
      await writeFile(path, JSON.stringify(raw), "utf-8");
      const reg = await loadRegistry(path);
      expect(reg.schemaVersion).toBe(2);
      expect(reg.sources).toHaveLength(1);
      expect(reg.sources[0]?.remote?.url).toBe("https://github.com/foo/bar.git");
      expect(reg.sources[0]?.remote?.ref).toBe("main");
    });
  });

  test("loads schemaVersion: 2 without remote block (source has no remote)", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 2,
          sources: [{ kind: "user-global", rootPath: "/tmp/y", label: "y" }],
        }),
        "utf-8",
      );
      const reg = await loadRegistry(path);
      expect(reg.schemaVersion).toBe(2);
      expect(reg.sources[0]?.remote).toBeUndefined();
    });
  });

  test("migrates v1 file (schemaVersion: 1) to v2 in-memory", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 1,
          sources: [{ kind: "user-global", rootPath: "/tmp/z", label: "z" }],
        }),
        "utf-8",
      );
      const reg = await loadRegistry(path);
      expect(reg.schemaVersion).toBe(2);
      expect(reg.sources).toHaveLength(1);
      expect(reg.sources[0]?.remote).toBeUndefined();
    });
  });

  test("migrates legacy 'version: 1' to v2 in-memory", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          sources: [{ kind: "user-global", rootPath: "/tmp/a", label: "a" }],
        }),
        "utf-8",
      );
      const reg = await loadRegistry(path);
      expect(reg.schemaVersion).toBe(2);
    });
  });

  test("rejects malformed remote.url", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 2,
          sources: [
            {
              kind: "registered",
              rootPath: "/tmp/x",
              label: "x",
              remote: { url: "", ref: "main" },
            },
          ],
        }),
        "utf-8",
      );
      await expect(loadRegistry(path)).rejects.toThrow();
    });
  });

  test("rejects malformed remote (missing ref)", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      await writeFile(
        path,
        JSON.stringify({
          schemaVersion: 2,
          sources: [
            {
              kind: "registered",
              rootPath: "/tmp/x",
              label: "x",
              remote: { url: "https://github.com/foo/bar.git" },
            },
          ],
        }),
        "utf-8",
      );
      await expect(loadRegistry(path)).rejects.toThrow();
    });
  });

  test("save+load roundtrip preserves remote block and emits schemaVersion: 2", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "registry.json");
      const reg: Registry = {
        schemaVersion: 2,
        sources: [
          {
            kind: "registered",
            rootPath: "/tmp/rt",
            label: "rt",
            gitRemote: "https://github.com/foo/bar.git",
            remote: {
              url: "https://github.com/foo/bar.git",
              ref: "main",
              lastPulledSha: "b".repeat(40),
              lastPulledAt: "2026-05-24T00:00:00.000Z",
            },
          },
        ],
      };
      await saveRegistry(path, reg);
      const onDisk = JSON.parse(await Bun.file(path).text());
      expect(onDisk.schemaVersion).toBe(2);
      const loaded = await loadRegistry(path);
      expect(loaded.sources[0]?.remote?.url).toBe("https://github.com/foo/bar.git");
      expect(loaded.sources[0]?.remote?.lastPulledSha).toBe("b".repeat(40));
    });
  });
});
