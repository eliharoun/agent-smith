import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chunk, kindForPath } from "./chunker";
import { type EmbedderCache } from "./embedder";
import { modelForKind } from "./model-policy";
import { extractTags } from "./repomap/extract";
import type { ChunkKind, ChunkRow, KnowledgeStore } from "./store";

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
  /** Per-kind query/embed models, lazily loaded by id. null => lexical-only
   *  (no hybrid sources this build). When present, each chunk is embedded with
   *  modelForKind(chunk.kind) — loaded on first chunk of that kind (fast path:
   *  a code-only hybrid source never loads the text model). */
  embedders: EmbedderCache | null;
  changedPaths: string[] | null;
  /** Source ids that opted into retrieval:hybrid; their chunks get dense vectors.
   *  Absent/empty = lexical-only (no vectors). Only these sources' chunks get
   *  dense vectors; all other sources stay lexical-only (FTS5) — spec §3.9. */
  hybridSourceIds?: Set<string>;
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
    // A file gets vectors only if hybrid embedding is active (embedders present)
    // AND its owning source opted into hybrid retrieval. `wantsVector` drives both
    // the skip check and the embed decision below so they can never diverge.
    const isHybrid = opts.hybridSourceIds?.has(sourceIdOf(rel)) ?? false;
    const wantsVector = opts.embedders !== null && isHybrid;
    // One kind per path (kind is a pure function of extension), so the expected
    // model is determined by the path alone — lets us skip-check before chunking.
    const expectedModelId = wantsVector ? modelForKind(kindForPath(rel)).id : null;
    // `hasVectorFor` is "ANY chunk for this path has a vector for that model", not
    // "all". A build interrupted mid-embed (chunks deleted+re-added, then embed
    // throws before upsert) leaves the path with NO chunks at all, so the
    // any-vs-all distinction can't strand a half-embedded file in practice — the
    // next build re-chunks from scratch (contentHashFor → null).
    //
    // A file is "current" only if its content is unchanged AND its vector state
    // matches its mode: a hybrid file needs its kind's-model vector present
    // (re-embed if a newly-available model or freshly-flipped mode left it
    // vector-less); a non-hybrid file needs none.
    const vectorsCurrent =
      !wantsVector || (expectedModelId !== null && opts.store.hasVectorFor(rel, expectedModelId));
    if (opts.store.contentHashFor(rel) === hash && vectorsCurrent) continue;

    opts.store.deleteByPath(rel);
    const chunks = await chunk({ relPath: rel, text });
    // Group chunk indices by kind and embed each group with its kind's model
    // (lazy per-kind load via the cache). Robust even if a path ever produced
    // mixed kinds; today it's one kind per path. A model that fails to load
    // (cache returns NullEmbedder) leaves that group lexical-only.
    //
    // If a real embedder throws here (e.g. OOM on a huge batch), buildIndex
    // rejects AFTER deleteByPath already ran — the path is left with no chunks
    // until the next build re-chunks it (contentHashFor → null forces redo).
    // That's a consistent (never partial) state; we don't catch per-file so the
    // failure surfaces to the caller rather than silently shipping a gap.
    const vecFor = new Map<number, { v: Float32Array; id: string; dim: number }>();
    if (wantsVector) {
      const byKind = new Map<ChunkKind, number[]>();
      chunks.forEach((c, i) => {
        const arr = byKind.get(c.kind) ?? [];
        arr.push(i);
        byKind.set(c.kind, arr);
      });
      for (const [kind, idxs] of byKind) {
        const ref = modelForKind(kind);
        const emb = await opts.embedders!.get(ref.modelId, ref.dim);
        if (emb.id === "none") continue; // load failed -> this kind stays lexical
        const vs = await emb.embed(idxs.map((i) => chunks[i]!.text));
        idxs.forEach((i, j) => {
          const v = vs[j];
          if (v) vecFor.set(i, { v, id: emb.id, dim: emb.dim });
        });
      }
    }
    const rows: ChunkRow[] = chunks.map((c, i) => {
      const got = vecFor.get(i);
      return {
        id: `${rel}#${i}`,
        sourceId: sourceIdOf(rel),
        relPath: rel,
        startLine: c.startLine,
        endLine: c.endLine,
        kind: c.kind,
        text: c.text,
        contentHash: hash,
        ...(got ? { vector: got.v, embedderId: got.id, embedderDim: got.dim } : {}),
      };
    });
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

  if (fullWalk) {
    for (const rel of opts.store.allRelPaths()) {
      if (!seen.has(rel)) {
        opts.store.deleteByPath(rel);
        continue;
      }
      // A path whose source is no longer hybrid must not keep a stale vector.
      // NOTE: only the full-walk path can fix this comprehensively (it visits
      // every path). An incremental refresh visits only changedPaths, so a mode
      // flip without a content change is corrected on the next full install.
      const stillHybrid = opts.hybridSourceIds?.has(sourceIdOf(rel)) ?? false;
      if (!stillHybrid && opts.store.hasVector(rel)) opts.store.clearVectorsByPath(rel);
    }
  }
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
