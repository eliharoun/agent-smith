import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chunk } from "./chunker";
import type { Embedder } from "./embedder";
import { extractTags } from "./repomap/extract";
import type { ChunkRow, KnowledgeStore } from "./store";

const INDEXED_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".html",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".c",
  ".cpp",
  ".h",
]);
const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".c",
  ".cpp",
  ".h",
]);

export interface BuildIndexOpts {
  knowledgeDir: string;
  store: KnowledgeStore;
  embedder: Embedder;
  changedPaths: string[] | null;
}

export async function buildIndex(opts: BuildIndexOpts): Promise<void> {
  const fullWalk = opts.changedPaths === null;
  const targets =
    opts.changedPaths === null
      ? await walkIndexed(opts.knowledgeDir)
      : opts.changedPaths.filter((p) => INDEXED_EXT.has(ext(p)));

  const seen = new Set<string>();
  for (const rel of targets) {
    seen.add(rel);
    const abs = join(opts.knowledgeDir, rel);
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      opts.store.deleteByPath(rel);
      continue;
    }
    const hash = createHash("sha256").update(text).digest("hex");
    // `hasVector` is "ANY chunk for this path has a vector", not "all". A build
    // interrupted mid-embed (chunks deleted+re-added, then embed throws before
    // upsert) leaves the path with NO chunks at all (see the embed note below),
    // so the any-vs-all distinction can't strand a half-embedded file in
    // practice — the next build re-chunks from scratch (contentHashFor → null).
    const vectorsCurrent = opts.embedder.id === "none" || opts.store.hasVector(rel);
    if (opts.store.contentHashFor(rel) === hash && vectorsCurrent) continue;

    opts.store.deleteByPath(rel);
    const chunks = await chunk({ relPath: rel, text });
    // If a real embedder throws here (e.g. OOM on a huge batch), buildIndex
    // rejects AFTER deleteByPath already ran — the path is left with no chunks
    // until the next build re-chunks it (contentHashFor → null forces redo).
    // That's a consistent (never partial) state; we don't catch per-file so the
    // failure surfaces to the caller rather than silently shipping a gap.
    const vectors =
      opts.embedder.id !== "none" ? await opts.embedder.embed(chunks.map((c) => c.text)) : [];
    const rows: ChunkRow[] = chunks.map((c, i) => ({
      id: `${rel}#${i}`,
      sourceId: sourceIdOf(rel),
      relPath: rel,
      startLine: c.startLine,
      endLine: c.endLine,
      kind: c.kind,
      text: c.text,
      contentHash: hash,
      ...(vectors[i] ? { vector: vectors[i] } : {}),
    }));
    opts.store.upsertChunks(rows);

    if (CODE_EXT.has(ext(rel))) {
      const tags = await extractTags(rel, text);
      opts.store.upsertTags(
        rel,
        hash,
        tags.map((t) => ({ name: t.name, role: t.role, line: t.line, signature: t.signature })),
      );
    }
  }

  if (fullWalk)
    for (const rel of opts.store.allRelPaths()) if (!seen.has(rel)) opts.store.deleteByPath(rel);
}

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i) : ""; // "" for dotless names (Makefile, LICENSE)
}
/** Materialized layout is sources/<id>/<file>; fall back to "root" otherwise. */
function sourceIdOf(rel: string): string {
  const parts = rel.split("/");
  return parts[0] === "sources" && parts[1] ? parts[1] : "root";
}

async function walkIndexed(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) await rec(abs);
      else if (e.isFile() && INDEXED_EXT.has(ext(e.name))) out.push(relative(root, abs));
    }
  }
  await rec(root);
  return out;
}
