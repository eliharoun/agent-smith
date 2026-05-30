import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __bundleCacheStatsForTest,
  __clearBundleCacheForTest,
  parseRegistry,
} from "./parse-registry";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "registry-"));
  file = join(dir, "registry.json");
  __clearBundleCacheForTest();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseRegistry", () => {
  it("returns empty catalogs when file missing", async () => {
    const reg = await parseRegistry(file);
    expect(reg.catalogs).toEqual({});
  });

  it("parses a minimal registry", async () => {
    await mkdir(join(dir, "catalogs", "default"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        catalogs: {
          default: {
            path: join(dir, "catalogs", "default"),
            agents: ["incident-debugger"],
          },
        },
      }),
      "utf8",
    );
    const reg = await parseRegistry(file);
    expect(reg.catalogs.default?.agents).toEqual(["incident-debugger"]);
  });

  it("self-heals on malformed JSON", async () => {
    await writeFile(file, "not json", "utf8");
    const reg = await parseRegistry(file);
    expect(reg.catalogs).toEqual({});
  });

  it("translates legacy CLI {version, sources} shape into catalogs", async () => {
    const catalogDir = join(dir, "agents");
    await mkdir(join(catalogDir, "alpha"), { recursive: true });
    await writeFile(join(catalogDir, "alpha", "agent.config.json"), "{}");
    await mkdir(join(catalogDir, "beta"), { recursive: true });
    await writeFile(join(catalogDir, "beta", "agent.config.json"), "{}");
    await mkdir(join(catalogDir, "no-config"), { recursive: true });

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", rootPath: catalogDir, label: "user-global" }],
      }),
    );

    const reg = await parseRegistry(file);
    expect(reg.catalogs["user-global"]).toBeDefined();
    expect(reg.catalogs["user-global"]?.path).toBe(catalogDir);
    expect(reg.catalogs["user-global"]?.agents).toEqual(["alpha", "beta"]);
  });

  it("returns empty agents for a CLI source whose rootPath does not exist", async () => {
    const ghost = join(dir, "ghost");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: ghost, label: "ghost" }],
      }),
    );
    const reg = await parseRegistry(file);
    expect(reg.catalogs.ghost).toEqual({ path: ghost, agents: [] });
  });

  it("[DW-9] discovers a single-bundle rootPath (top-level agent.config.json)", async () => {
    // Remote-installed catalogs (smith agent install --from <url>) clone
    // single-bundle git repos whose agent.config.json sits at the TOP of
    // the clone, not under a subdirectory. listAgentBundles used to walk
    // subdirs only, so /api/agents and /api/catalogs both returned
    // empty for these — the GUI couldn't see remote-installed agents at
    // all. Same root-cause family as DW-2 (listAgentDirs) and DW-5
    // (sniffPath).
    //
    // The fix is two-part: surface the bundle name as basename(rootPath)
    // AND reset the catalog path to dirname(rootPath), so the existing
    // `join(info.path, bundleName)` pattern used by every downstream
    // route (agents.ts, scanBundle, etc.) resolves back to rootPath
    // without per-route changes.
    const bundleDir = join(dir, "owner-repo");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "agent.config.json"), "{}");

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: bundleDir, label: "owner/repo" }],
      }),
    );

    const reg = await parseRegistry(file);
    expect(reg.catalogs["owner/repo"]?.agents).toEqual(["owner-repo"]);
    expect(reg.catalogs["owner/repo"]?.path).toBe(dir);
    // Round-trip: join(info.path, bundleName) === rootPath
    const entry = reg.catalogs["owner/repo"];
    expect(entry).toBeDefined();
    if (entry) expect(join(entry.path, "owner-repo")).toBe(bundleDir);
  });

  it("[DW-9] a rootPath with BOTH a top-level config AND sub-bundles surfaces both", async () => {
    // Defensive: nothing prevents a publisher from shipping a hybrid
    // layout. Surface both shapes so neither is silently dropped. The
    // single-bundle wins for the catalog path so its basename resolves
    // correctly; sub-bundles surface as additional names. The CLI never
    // produces a hybrid in practice.
    const hybrid = join(dir, "hybrid");
    await mkdir(join(hybrid, "child"), { recursive: true });
    await writeFile(join(hybrid, "agent.config.json"), "{}");
    await writeFile(join(hybrid, "child", "agent.config.json"), "{}");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "registered", rootPath: hybrid, label: "hybrid" }],
      }),
    );
    const reg = await parseRegistry(file);
    expect(reg.catalogs.hybrid?.agents).toContain("child");
    expect(reg.catalogs.hybrid?.agents).toContain("hybrid");
  });

  it("warns and returns empty when JSON is neither GUI nor CLI shape", async () => {
    await writeFile(file, JSON.stringify({ totally: "wrong" }));
    const reg = await parseRegistry(file);
    expect(reg.catalogs).toEqual({});
  });

  it("warns and keeps first when CLI sources have duplicate labels", async () => {
    const firstDir = join(dir, "first");
    const secondDir = join(dir, "second");
    await mkdir(join(firstDir, "alpha"), { recursive: true });
    await writeFile(join(firstDir, "alpha", "agent.config.json"), "{}");
    await mkdir(join(secondDir, "beta"), { recursive: true });
    await writeFile(join(secondDir, "beta", "agent.config.json"), "{}");

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [
          { kind: "user-global", rootPath: firstDir, label: "main" },
          { kind: "user-global", rootPath: secondDir, label: "main" },
        ],
      }),
    );

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reg = await parseRegistry(file);
      expect(reg.catalogs.main?.path).toBe(firstDir);
      expect(reg.catalogs.main?.agents).toEqual(["alpha"]);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("duplicate label"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("caches directory scans when mtime is unchanged", async () => {
    const catalogDir = join(dir, "agents");
    await mkdir(join(catalogDir, "alpha"), { recursive: true });
    await writeFile(join(catalogDir, "alpha", "agent.config.json"), "{}");

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", rootPath: catalogDir, label: "main" }],
      }),
    );

    const before = __bundleCacheStatsForTest();
    await parseRegistry(file);
    const afterFirst = __bundleCacheStatsForTest();
    expect(afterFirst.misses).toBe(before.misses + 1);

    await parseRegistry(file);
    const afterSecond = __bundleCacheStatsForTest();
    expect(afterSecond.hits).toBe(afterFirst.hits + 1);
    expect(afterSecond.misses).toBe(afterFirst.misses);
  });

  it("invalidates the cache when rootPath mtime changes", async () => {
    const catalogDir = join(dir, "agents");
    await mkdir(join(catalogDir, "alpha"), { recursive: true });
    await writeFile(join(catalogDir, "alpha", "agent.config.json"), "{}");

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: [{ kind: "user-global", rootPath: catalogDir, label: "main" }],
      }),
    );

    const reg1 = await parseRegistry(file);
    expect(reg1.catalogs.main?.agents).toEqual(["alpha"]);

    // Add a new bundle — directory mtime updates because a child was added.
    await mkdir(join(catalogDir, "beta"), { recursive: true });
    await writeFile(join(catalogDir, "beta", "agent.config.json"), "{}");

    const before = __bundleCacheStatsForTest();
    const reg2 = await parseRegistry(file);
    const after = __bundleCacheStatsForTest();
    expect(reg2.catalogs.main?.agents).toEqual(["alpha", "beta"]);
    expect(after.misses).toBe(before.misses + 1);
  });
});
