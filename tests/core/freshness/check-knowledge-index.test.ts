import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkKnowledgeIndex } from "../../../src/core/freshness/check-knowledge-index";
import { indexDbPath } from "../../../src/core/knowledge/index/index-paths";
import { KnowledgeStore } from "../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kindex-doctor-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CURRENT_HEADER = {
  schemaVersion: 2,
  embedders: [],
  chunkerVersion: 1,
  modelPolicyVersion: 1,
  repomapVersion: 1,
};

async function writeManifest(knowledgeDir: string, sources: unknown[]): Promise<void> {
  await mkdir(knowledgeDir, { recursive: true });
  await writeFile(
    join(knowledgeDir, "_manifest.json"),
    JSON.stringify({ schemaVersion: 1, renderedAt: new Date().toISOString(), sources, totals: {} }),
  );
}

describe("checkKnowledgeIndex", () => {
  test("healthy current-schema DB → no finding", async () => {
    const kd = join(dir, "healthy");
    const s = await KnowledgeStore.open(indexDbPath(kd), CURRENT_HEADER);
    s!.close();
    const r = await checkKnowledgeIndex({ candidates: [{ name: "a", knowledgeDir: kd }] });
    expect(r.status).toBe("ok");
    expect(r.findings).toEqual([]);
  });

  test("stale schema-1 DB (file exists, readonly open null) → stale-index", async () => {
    const { Database } = await import("bun:sqlite");
    const kd = join(dir, "stale");
    await mkdir(join(kd, ".cache", "index"), { recursive: true });
    const raw = new Database(indexDbPath(kd), { create: true });
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);" +
        "CREATE TABLE chunks (id TEXT PRIMARY KEY, source_id TEXT, rel_path TEXT, start_line INTEGER, end_line INTEGER, kind TEXT, text TEXT, content_hash TEXT, embedding BLOB);",
    );
    raw.query("INSERT INTO meta(key,value) VALUES(?,?)").run("schemaVersion", "1");
    raw.close();
    const r = await checkKnowledgeIndex({ candidates: [{ name: "a", knowledgeDir: kd }] });
    expect(r.status).toBe("warn");
    expect(r.findings).toEqual([{ kind: "stale-index", agent: "a" }]);
  });

  test("materialized sources but no DB → missing-index", async () => {
    const kd = join(dir, "missing");
    await writeManifest(kd, [
      {
        id: "guide",
        scope: "agent",
        type: "dir",
        delivery: "file",
        files: [{ path: "sources/guide/a.md", sha256: "h", bytes: 10 }],
        tokensInline: 0,
      },
    ]);
    const r = await checkKnowledgeIndex({ candidates: [{ name: "a", knowledgeDir: kd }] });
    expect(r.findings).toEqual([{ kind: "missing-index", agent: "a" }]);
  });

  test("manifest with only lazy/zero-file sources, no DB → no finding", async () => {
    const kd = join(dir, "lazy");
    await writeManifest(kd, [
      { id: "lz", scope: "agent", type: "webpage", delivery: "lazy", files: [], tokensInline: 0 },
    ]);
    const r = await checkKnowledgeIndex({ candidates: [{ name: "a", knowledgeDir: kd }] });
    expect(r.findings).toEqual([]);
  });

  test("no manifest, no DB → skipped (no finding)", async () => {
    const kd = join(dir, "empty");
    await mkdir(kd, { recursive: true });
    const r = await checkKnowledgeIndex({ candidates: [{ name: "a", knowledgeDir: kd }] });
    expect(r.findings).toEqual([]);
  });

  test("mixed candidates produce both finding kinds", async () => {
    const { Database } = await import("bun:sqlite");
    const staleKd = join(dir, "m-stale");
    await mkdir(join(staleKd, ".cache", "index"), { recursive: true });
    const raw = new Database(indexDbPath(staleKd), { create: true });
    raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
    raw.query("INSERT INTO meta(key,value) VALUES(?,?)").run("schemaVersion", "1");
    raw.close();

    const missKd = join(dir, "m-missing");
    await writeManifest(missKd, [
      {
        id: "g",
        scope: "agent",
        type: "dir",
        delivery: "file",
        files: [{ path: "sources/g/a.md", sha256: "h", bytes: 5 }],
        tokensInline: 0,
      },
    ]);

    const healthyKd = join(dir, "m-healthy");
    const s = await KnowledgeStore.open(indexDbPath(healthyKd), CURRENT_HEADER);
    s!.close();

    const r = await checkKnowledgeIndex({
      candidates: [
        { name: "stale-one", knowledgeDir: staleKd },
        { name: "missing-one", knowledgeDir: missKd },
        { name: "healthy-one", knowledgeDir: healthyKd },
      ],
    });
    expect(r.status).toBe("warn");
    expect(r.findings).toEqual([
      { kind: "stale-index", agent: "stale-one" },
      { kind: "missing-index", agent: "missing-one" },
    ]);
  });
});
