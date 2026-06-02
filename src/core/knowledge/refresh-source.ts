// src/core/knowledge/refresh-source.ts
//
// `refreshSource()` is the per-source refresh primitive used by the daemon
// (TTL mode) and the session hook (session/always modes). It is independent
// of the full `runKnowledgeStage` rebuild path: it touches exactly one
// `<agent>/knowledge/sources/<sourceId>/` directory and incrementally
// updates `<agent>/knowledge/_manifest.json` under a per-agent lock.
//
// Workflow:
//   1. Inline/auto delivery → no-op (handled at higher layer).
//   2. Unsupported source type → skipped.
//   3. Sweep orphan `.tmp-*` dirs left from prior crashes.
//   4. Acquire + materialize into a fresh tmp dir (LOCK-FREE — this is the
//      slow path and must not block other refreshes on the same agent).
//   5. Acquire the per-agent manifest lock; bail with `lock-held` if taken.
//   6. Read existing manifest (or treat as empty), atomic-swap the tmp dir
//      over the live `sources/<id>/`, update the manifest entry for this
//      source, write manifest, release lock.
//
// Failure semantics: any error after materialize but before the rename
// leaves the previous `sources/<id>/` untouched (last-good preserved). The
// tmp dir is unconditionally removed in a `finally`. Manifest read/parse
// errors are wrapped so the message references the manifest.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWithin } from "../../io/assert-within";
import { knowledgeDirFor } from "../../io/knowledge-paths";
import { toMessage } from "../to-message";
import type { AcquiredArtifact, GitSpawner } from "./acquire";
import { acquireSource, chooseMaterializer, isAcquirable, runMaterializer } from "./acquire-source";
import { acquireManifestLock, releaseRefreshLock } from "./refresh-lock";
import { estimateTokens } from "./tokens";
import type {
  KnowledgeManifest,
  KnowledgeManifestSourceEntry,
  KnowledgeSource,
  MaterializedFile,
} from "./types";

export interface RefreshSourceOpts {
  agentSmithHome: string;
  agent: string;
  source: KnowledgeSource;
  bundleDir: string;
  gitSpawner?: GitSpawner;
  now?: () => number;
  errLog?: (msg: string) => void;
  cacheRoot?: string;
  /** MCP client pool for via-routed URL sources. Required when any source
   *  declares `via:` — `acquireSource` throws otherwise. Sources without
   *  via: ignore this. */
  mcpPool?: import("../../io/mcp-client-pool").McpClientPool;
  /** Resolves a server name to spawn options. Paired with `mcpPool`. */
  spawnOptsFor?: (server: string) => import("../../io/mcp-client").McpClientOpts;
}

export type RefreshSourceResult =
  | {
      kind: "refreshed";
      sourceId: string;
      bytes: number;
      entries: number;
      tokens: number;
      durationMs: number;
    }
  | { kind: "inline-only"; sourceId: string; delivery: "inline" | "auto" }
  | { kind: "lock-held"; sourceId: string }
  | { kind: "skipped"; sourceId: string; reason: "unsupported-source-type" };

/**
 * Wrap an unknown thrown value with a phase-tagged Error preserving the
 * cause chain. `phase` is the user-visible context that precedes the
 * underlying message — e.g. "refresh of source foo for agent bar".
 * Result: `<phase>: <underlying message>` with err set as cause.
 */
function wrapWithPhase(phase: string, err: unknown): Error {
  return new Error(`${phase}: ${toMessage(err)}`, { cause: err });
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function summarize(content: string): string {
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].slice(0, 200);
  return content.replace(/\s+/g, " ").trim().slice(0, 200);
}

function sourcesDirFor(agentSmithHome: string, agent: string): string {
  return join(knowledgeDirFor(agent, { agentSmithHome }), "sources");
}

function manifestPathFor(agentSmithHome: string, agent: string): string {
  return join(knowledgeDirFor(agent, { agentSmithHome }), "_manifest.json");
}

/** Remove any stale `.<sourceId>.tmp-*` or `.<sourceId>.prev-*` dir under
 *  sources/. Both patterns indicate a crashed prior refresh:
 *    - `.tmp-*` is the materialize target before atomic swap.
 *    - `.prev-*` is the move-aside copy of the previous live dir; left
 *      behind if the second rename of the swap failed.
 *  Anchored on the literal `<sourceId>.` prefix so we never reap a tmp
 *  dir belonging to a different (similarly-named) source. Best-effort:
 *  swallowed errors here would mask the real failure later. */
async function sweepOrphanTmpDirs(sourcesDir: string, sourceId: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(sourcesDir);
  } catch {
    return; // sources/ doesn't exist yet — nothing to sweep.
  }
  const tmpPrefix = `.${sourceId}.tmp-`;
  const prevPrefix = `.${sourceId}.prev-`;
  for (const e of entries) {
    if (e.startsWith(tmpPrefix) || e.startsWith(prevPrefix)) {
      await rm(join(sourcesDir, e), { recursive: true, force: true });
    }
  }
}

/** Materialize acquired artifacts into `tmpDir` and return the per-file
 *  metadata used to build a manifest entry. */
async function materializeIntoDir(
  src: KnowledgeSource,
  artifacts: AcquiredArtifact[],
  tmpDir: string,
  sourceId: string,
): Promise<{ files: MaterializedFile[]; bytes: number; tokensIfInline: number }> {
  await mkdir(tmpDir, { recursive: true });
  const files: MaterializedFile[] = [];
  const inlineParts: string[] = [];
  let totalBytes = 0;

  for (const art of artifacts) {
    const m = chooseMaterializer(src, art);
    const { content } = runMaterializer(m, art);
    const outRel = art.relPath || art.filename;
    const absOut = join(tmpDir, outRel);
    // Defense-in-depth [v1-task B6]: artifact relPath/filename ultimately
    // come from URL pathnames or git-tree walks; both are structurally safe
    // today but a hostile remote could craft a path with ".." segments. We
    // ensure the resolved write target sits under tmpDir before any IO.
    await assertWithin(absOut, tmpDir);
    await mkdir(dirname(absOut), { recursive: true });
    await writeFile(absOut, content, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    files.push({
      relPath: join("sources", sourceId, outRel).replaceAll("\\", "/"),
      bytes,
      sha256: sha256(content),
      summary: summarize(content),
    });
    totalBytes += bytes;
    inlineParts.push(content);
  }

  return {
    files,
    bytes: totalBytes,
    tokensIfInline: estimateTokens(inlineParts.join("\n\n")),
  };
}

function buildManifestEntry(
  src: KnowledgeSource,
  files: MaterializedFile[],
  tokensInline: number,
  fetchedAt: string,
): KnowledgeManifestSourceEntry {
  const provenance: { url?: string; path?: string } = {};
  if ("url" in src && src.url) provenance.url = src.url;
  if ("path" in src && src.path) provenance.path = src.path;
  return {
    id: src.id,
    scope: "agent",
    type: src.type,
    ...(Object.keys(provenance).length > 0 ? { source: provenance } : {}),
    delivery: src.delivery === "auto" ? "file" : src.delivery,
    files: files.map((f) => ({
      path: f.relPath,
      sha256: f.sha256,
      bytes: f.bytes,
      ...(f.summary ? { summary: f.summary } : {}),
    })),
    fetchedAt,
    extractor: null,
    tokensInline,
    ...(src.description ? { description: src.description } : {}),
  };
}

/** Read an existing manifest at `path`, or synthesize an empty one if the
 *  file doesn't exist. JSON parse errors are re-thrown with a manifest-tagged
 *  message so callers can surface "the manifest is bad" rather than a
 *  generic SyntaxError. */
async function readManifestOrEmpty(path: string): Promise<KnowledgeManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        schemaVersion: 1,
        renderedAt: new Date(0).toISOString(),
        sources: [],
        totals: { tokensInline: 0, tokensInlineBudget: 0, files: 0, bytes: 0 },
      };
    }
    throw wrapWithPhase(`failed to read knowledge _manifest.json at ${path}`, err);
  }
  try {
    return JSON.parse(raw) as KnowledgeManifest;
  } catch (err) {
    throw wrapWithPhase(`failed to parse knowledge _manifest.json at ${path}`, err);
  }
}

export async function refreshSource(opts: RefreshSourceOpts): Promise<RefreshSourceResult> {
  const { source, agent, agentSmithHome } = opts;
  const sourceId = source.id;
  const sourcesDir = sourcesDirFor(agentSmithHome, agent);

  // Defense-in-depth path containment [v1-task B6]. refreshSource() is
  // reached by the daemon and session-runner WITHOUT going through any
  // CLI verb that calls assertValidAgentName, so this is the only place
  // a malicious agent name could slip through. We ensure agentSmithHome
  // exists (cheap idempotent) then assert both derived paths sit under
  // it; an agent name containing ".." or "/" would fail here before any
  // mkdir/rm/rename happens.
  await mkdir(agentSmithHome, { recursive: true });
  await assertWithin(sourcesDir, agentSmithHome);
  await assertWithin(manifestPathFor(agentSmithHome, agent), agentSmithHome);

  // 1. Unconditional orphan cleanup — must run before any early-return so
  //    a crash leftover gets reaped regardless of whether the operator has
  //    since flipped this source to inline/auto/npm. sweepOrphanTmpDirs
  //    no-ops on a missing sources/ dir.
  await sweepOrphanTmpDirs(sourcesDir, sourceId);

  // 2. Inline/auto delivery → no per-source on-disk artifact to update.
  if (source.delivery === "inline" || source.delivery === "auto") {
    return { kind: "inline-only", sourceId, delivery: source.delivery };
  }

  // 3. Unsupported source types — match acquire-source.ts boundary.
  if (!isAcquirable(source.type)) {
    return { kind: "skipped", sourceId, reason: "unsupported-source-type" };
  }

  const tmpName = `.${sourceId}.tmp-${randomBytes(6).toString("hex")}`;
  const tmpDir = join(sourcesDir, tmpName);
  const finalDir = join(sourcesDir, sourceId);
  const now = opts.now ?? Date.now;
  const startedAt = now();

  // Cache root for url/git acquirers. Default to a sibling of the agent's
  // knowledge dir so test homes don't pollute the user's real cache.
  const cacheDir = opts.cacheRoot ?? join(knowledgeDirFor(agent, { agentSmithHome }), ".cache");

  // 4. Acquire (lock-free).
  let artifacts: AcquiredArtifact[];
  try {
    const acquired = await acquireSource(source, {
      bundleDir: opts.bundleDir,
      cacheDir,
      ...(opts.gitSpawner ? { gitSpawner: opts.gitSpawner } : {}),
      ...(opts.mcpPool ? { mcpPool: opts.mcpPool } : {}),
      ...(opts.spawnOptsFor ? { spawnOptsFor: opts.spawnOptsFor } : {}),
    });
    artifacts = acquired.artifacts;
  } catch (err) {
    throw wrapWithPhase(
      `refresh of source ${sourceId} for agent ${agent} failed during acquire`,
      err,
    );
  }

  // 5. Materialize into tmp dir (lock-free). On any failure here we want to
  //    leave the existing sources/<id>/ untouched and clean the tmp.
  let materialized: Awaited<ReturnType<typeof materializeIntoDir>>;
  try {
    // Ensure sources/ exists so mkdir of tmp succeeds. On test 7 sources/
    // exists but is read-only, so this mkdir is a no-op and the next one
    // (inside materializeIntoDir) is what fails — that's the desired path.
    await mkdir(sourcesDir, { recursive: true });
    materialized = await materializeIntoDir(source, artifacts, tmpDir, sourceId);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true });
    throw wrapWithPhase(
      `refresh of source ${sourceId} for agent ${agent} failed during materialize`,
      err,
    );
  }

  // 6. Acquire manifest lock for the read-modify-write window.
  const lock = await acquireManifestLock(agentSmithHome, agent);
  if (!lock) {
    await rm(tmpDir, { recursive: true, force: true });
    return { kind: "lock-held", sourceId };
  }

  try {
    const manifestPath = manifestPathFor(agentSmithHome, agent);
    let manifest: KnowledgeManifest;
    try {
      manifest = await readManifestOrEmpty(manifestPath);
    } catch (err) {
      // Bubble up with sourceId/agent context preserved; the original
      // message already mentions "_manifest.json".
      throw wrapWithPhase(`refresh of source ${sourceId} for agent ${agent}`, err);
    }

    // Atomic swap from a concurrent reader's perspective. Rename the live
    // dir aside first, then rename the tmp into the live path. The live
    // path therefore points at either the previous content or the new
    // content on every observable instant — never absent. The aside copy
    // is removed best-effort after the swap; failure to remove it leaves
    // a `.prev-*` orphan but does not roll back the successful refresh.
    const prevDir = `${finalDir}.prev-${randomBytes(6).toString("hex")}`;
    let movedAside = false;
    try {
      await rename(finalDir, prevDir);
      movedAside = true;
    } catch (err) {
      // ENOENT means there was no previous content — fresh install. Any
      // other error (EACCES, EBUSY, …) propagates so we don't paper over
      // a real swap failure.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await rename(tmpDir, finalDir);
    if (movedAside) {
      await rm(prevDir, { recursive: true, force: true }).catch(() => {});
    }

    // Build the new manifest entry. For non-inline delivery the per-source
    // tokensInline is 0 (matches pipeline.ts behavior for file delivery).
    const fetchedAt = new Date(now()).toISOString();
    const newEntry = buildManifestEntry(source, materialized.files, 0, fetchedAt);

    // Incremental update: preserve every entry whose id !== this source's.
    const otherSources = manifest.sources.filter((s) => s.id !== sourceId);
    const nextSources = [...otherSources, newEntry];

    // Recompute totals.files / totals.bytes from the full list. Preserve
    // tokensInline / tokensInlineBudget verbatim — those are owned by the
    // inline-delivery accounting path, not by per-source refresh.
    const totalFiles = nextSources.reduce((n, s) => n + s.files.length, 0);
    const totalBytes = nextSources.reduce(
      (n, s) => n + s.files.reduce((m, f) => m + f.bytes, 0),
      0,
    );

    const nextManifest: KnowledgeManifest = {
      schemaVersion: manifest.schemaVersion ?? 1,
      renderedAt: fetchedAt,
      sources: nextSources,
      totals: {
        tokensInline: manifest.totals?.tokensInline ?? 0,
        tokensInlineBudget: manifest.totals?.tokensInlineBudget ?? 0,
        files: totalFiles,
        bytes: totalBytes,
      },
    };

    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(nextManifest, null, 2), "utf8");

    return {
      kind: "refreshed",
      sourceId,
      bytes: materialized.bytes,
      entries: materialized.files.length,
      tokens: materialized.tokensIfInline,
      durationMs: Math.max(0, now() - startedAt),
    };
  } catch (err) {
    // If the rename succeeded but a later step (manifest write) failed,
    // the tmpDir no longer exists — rm is a no-op. If it failed before
    // rename, this cleans up.
    await rm(tmpDir, { recursive: true, force: true });
    if (err instanceof Error && err.message.includes(sourceId) && err.message.includes(agent)) {
      throw err;
    }
    throw wrapWithPhase(`refresh of source ${sourceId} for agent ${agent} failed`, err);
  } finally {
    await releaseRefreshLock(lock);
  }
}

// (end of file)
