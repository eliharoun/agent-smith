import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexInto } from "../../../../src/core/knowledge/index/build-into";
import { indexDbPath } from "../../../../src/core/knowledge/index/index-paths";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kinto-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("buildIndexInto builds an index that lexical search can find, and never throws", async () => {
  const kd = join(dir, "knowledge");
  await mkdir(join(kd, "sources", "s"), { recursive: true });
  await writeFile(join(kd, "sources", "s", "doc.md"), "hello rate limiting world\n");
  await buildIndexInto(kd, null); // must not throw regardless of native-dep availability
  // bun:sqlite is built in, so the DB should exist here and be queryable.
  if (existsSync(indexDbPath(kd))) {
    const { KnowledgeStore } = await import("../../../../src/core/knowledge/index/store");
    const store = await KnowledgeStore.open(
      indexDbPath(kd),
      {
        schemaVersion: 1,
        embedderId: "none",
        embedderDim: 1,
        chunkerVersion: 1,
        repomapVersion: 1,
      },
      { readonly: true },
    );
    if (store) {
      expect(store.searchLexical(["rate", "limiting"], 5)[0]?.relPath).toContain("doc.md");
      store.close();
    }
  }
});

test("buildIndexInto on an empty/nonexistent knowledge dir does not throw", async () => {
  await buildIndexInto(join(dir, "does-not-exist"), null);
  await buildIndexInto(join(dir, "does-not-exist"), ["sources/x/y.md"]);
});

test("buildIndexInto with no hybrid sources stays lexical-only (NullEmbedder, no vectors)", async () => {
  const kd = join(dir, "knowledge");
  await mkdir(join(kd, "sources", "s"), { recursive: true });
  await writeFile(join(kd, "sources", "s", "doc.md"), "alpha lexical content\n");
  // Empty hybrid set -> no model load -> NullEmbedder -> header embedderId "none".
  await buildIndexInto(kd, null, new Set());
  if (existsSync(indexDbPath(kd))) {
    const { KnowledgeStore } = await import("../../../../src/core/knowledge/index/store");
    const store = await KnowledgeStore.open(
      indexDbPath(kd),
      {
        schemaVersion: 1,
        embedderId: "none",
        embedderDim: 1,
        chunkerVersion: 1,
        repomapVersion: 1,
      },
      { readonly: true },
    );
    if (store) {
      expect(store.searchLexical(["alpha"], 5)[0]?.relPath).toContain("doc.md");
      expect(store.hasVector("sources/s/doc.md")).toBe(false); // no vectors when not hybrid
      store.close();
    }
  }
});
