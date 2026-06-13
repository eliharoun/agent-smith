import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kstats-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const H = {
  schemaVersion: 1,
  embedders: [{ id: "emb-a", dim: 3 }],
  chunkerVersion: 1,
  modelPolicyVersion: 1,
  repomapVersion: 1,
};

function chunk(
  id: string,
  sourceId: string,
  relPath: string,
  vector?: Float32Array,
  embedderId?: string,
) {
  return {
    id,
    sourceId,
    relPath,
    startLine: 1,
    endLine: 2,
    kind: "prose" as const,
    text: `text ${id}`,
    contentHash: `h-${id}`,
    ...(vector ? { vector, embedderId: embedderId ?? "emb-a", embedderDim: vector.length } : {}),
  };
}

describe("KnowledgeStore.stats", () => {
  test("empty index: zero counts, embedders empty (no live vectors)", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    const stats = s.stats();
    expect(stats.chunks).toBe(0);
    expect(stats.vectors).toBe(0);
    expect(stats.taggedPaths).toBe(0);
    // embedders now derive from LIVE vectors (not the header meta); an empty
    // index has none.
    expect(stats.embedders).toEqual([]);
    expect(stats.perSource).toEqual([]);
    s.close();
  });

  test("mixed sources: per-source chunk and vector counts", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "alpha", "sources/alpha/a.md", new Float32Array([1, 0, 0])),
      chunk("2", "alpha", "sources/alpha/b.md", new Float32Array([0, 1, 0])),
      chunk("3", "beta", "sources/beta/c.md"),
    ]);
    const stats = s.stats();
    expect(stats.chunks).toBe(3);
    expect(stats.vectors).toBe(2);
    // top-level embedders: the only live model id present.
    expect(stats.embedders).toEqual([{ id: "emb-a", dim: 3 }]);
    expect(stats.perSource).toEqual([
      { sourceId: "alpha", chunks: 2, vectors: 2, models: ["emb-a"] },
      { sourceId: "beta", chunks: 1, vectors: 0, models: [] },
    ]);
    s.close();
  });

  test("per-source models: each source carries the model ids that embedded its live vectors", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "code-src", "sources/code-src/a.ts", new Float32Array([1, 0, 0]), "code@1"),
      chunk("2", "prose-src", "sources/prose-src/b.md", new Float32Array([0, 1, 0]), "text@1"),
    ]);
    const stats = s.stats();
    const byId = new Map(stats.perSource.map((p) => [p.sourceId, p]));
    expect(byId.get("code-src")!.models).toEqual(["code@1"]);
    expect(byId.get("prose-src")!.models).toEqual(["text@1"]);
    // top-level embedders covers both distinct live models.
    expect(stats.embedders.map((e) => e.id).sort()).toEqual(["code@1", "text@1"]);
    s.close();
  });

  test("taggedPaths counts distinct tagged rel_paths", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertTags("sources/alpha/a.ts", "h-a", [
      { name: "foo", role: "def", line: 1, signature: "foo()" },
      { name: "bar", role: "def", line: 2, signature: "bar()" },
    ]);
    await s.upsertTags("sources/alpha/b.ts", "h-b", [
      { name: "baz", role: "def", line: 1, signature: "baz()" },
    ]);
    const stats = s.stats();
    expect(stats.taggedPaths).toBe(2);
    s.close();
  });
});
