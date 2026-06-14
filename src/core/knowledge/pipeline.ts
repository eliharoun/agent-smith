import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWithin } from "../../io/assert-within";
import type { McpClientOpts } from "../../io/mcp-client";
import type { McpClientPool } from "../../io/mcp-client-pool";
import { SmithError } from "../smith-error";
import { toMessage } from "../to-message";
import type { AcquiredArtifact, GitSpawner } from "./acquire";
import { urlCacheKey } from "./acquire";
import { acquireSource, chooseMaterializer, runMaterializer } from "./acquire-source";
import { type CompiledKnowledge, compile } from "./compile";
import { writeCompileManifest } from "./compile-manifest";
import { buildCompileOptionsFromBundle } from "./compile-options";
import { buildIndexInto } from "./index/build-into";
import { isLazyUrlSource, lazyDescriptionWarnings } from "./lazy-url";
import {
  ensureRelativeSymlink,
  sweepStaleCacheEntries,
  sweepStaleRepoSymlinks,
} from "./repo-symlinks";
import { estimateTokens } from "./tokens";
import type {
  EffectiveDelivery,
  KnowledgeBlock,
  KnowledgeManifest,
  KnowledgeManifestSourceEntry,
  KnowledgeSection,
  KnowledgeSource,
  MaterializedFile,
  MaterializedSource,
} from "./types";

export interface PipelinePaths {
  bundleDir: string;
  knowledgeDir: string;
  cacheDir: string;
}

export interface PipelineResult {
  manifest: KnowledgeManifest;
  section: KnowledgeSection;
  warnings: string[];
  errors: string[];
  /**
   * v2.1: present when `block.compile?.progressive === true` OR when the
   * materialized corpus exceeds the inline budget (smart default). Set
   * `compile.progressive: false` to pin the v1 path regardless of size.
   */
  compiled?: CompiledKnowledge;
}

/**
 * Optional dependency-injection hooks for `runKnowledgeStage`. Production
 * callers omit this; tests pass `gitSpawner` to stub git invocations.
 */
export interface RunKnowledgeStageOpts {
  gitSpawner?: GitSpawner;
  /** Pool for via-routed URL sources. Forwarded into `acquireSource` so
   *  knowledge sources with explicit `via:` declarations re-use the
   *  process-wide MCP client pool rather than reconnecting per source. */
  mcpPool?: McpClientPool;
  /** Resolver for spawn opts of a named MCP server. Required when
   *  `mcpPool` is set. */
  spawnOptsFor?: (server: string) => McpClientOpts;
  /** Phase 3: per-user routing cache (Layer 3). Forwarded into
   *  `acquireSource` so URL sources without explicit `via:` can resolve
   *  through the cached route before falling back to direct HTTP. */
  routeCache?: import("./route-cache").RouteCache;
  /** Phase 3: _meta claims pre-extracted from the bundle's MCP servers
   *  (Layer 2). Forwarded into `acquireSource`. */
  metaClaims?: import("./route-meta").MetaClaim[];
  /** Phase 3: probe-on-failure callback. Caller decides whether to enable
   *  (typically TTY-gated). Forwarded into `acquireSource`. */
  probeOnFailure?: (url: string) => Promise<{ server: string; tool: string } | null>;
  /** Phase 3: callback to record a confirmed route into the cache.
   *  Forwarded into `acquireSource`. */
  recordRoute?: (route: { url: string; server: string; tool: string }) => Promise<void>;
}

const DEFAULT_INLINE_BUDGET = 8000;

/**
 * Smart default for compile mode (v2.1): compile when the materialized corpus
 * exceeds the inline budget. Bundles whose entire knowledge fits inline are
 * better off with v1 inline-and-grants delivery — paying a tool round-trip for
 * content that's small and constantly relevant is wasteful. Once the corpus
 * overflows the budget, v1's silent inline truncation kicks in and progressive
 * disclosure wins.
 *
 * Threshold is `block.inlineBudget.totalTokens` (default 8000), reusing the v1
 * inline-budget knob exactly so there's no new tunable.
 *
 * Signal is `manifest.totals.bytes / 4` (a 4-bytes-per-token heuristic). We
 * deliberately don't use `manifest.totals.tokensInline`: that field only counts
 * sources actually inlined, so a corpus delivered entirely as `file` would read
 * as 0 tokens and never auto-compile. Bytes/4 is the cheapest unbiased proxy
 * for the full corpus and avoids re-reading source content here.
 */
/**
 * Decision used by both the live install path (`runKnowledgeStage`) and
 * the GUI's drift-check dry-run: should we compile (v2.1) the materialized
 * corpus, or fall back to the v1 inline+discipline+index path?
 *
 * Exported so the dry-run service can replicate the same compile-or-not
 * decision the orchestrator made, ensuring the bytes in the rendered body
 * match the bytes the installer wrote.
 */
export function shouldAutoCompile(
  manifest: KnowledgeManifest,
  block: KnowledgeBlock | undefined,
): boolean {
  // Respect explicit author intent: any source declared `delivery: "inline"` is
  // the user saying "keep this in working memory regardless." Defer to v1 mode
  // for the whole bundle in that case — the validator's hard-limit check is
  // the right place to surface overflow when the user explicitly asks for it.
  const hasExplicitInline = (block?.sources ?? []).some((s) => s.delivery === "inline");
  if (hasExplicitInline) return false;
  const budget = block?.inlineBudget?.totalTokens ?? DEFAULT_INLINE_BUDGET;
  const estimatedTotalTokens = Math.ceil(manifest.totals.bytes / 4);
  return estimatedTotalTokens > budget;
}

interface ProcessedSource {
  declared: KnowledgeSource;
  effectiveDelivery: EffectiveDelivery;
  artifacts: AcquiredArtifact[];
  materializedTexts: { artifact: AcquiredArtifact; content: string }[];
  warnings: string[];
}

function summarize(content: string): string {
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].slice(0, 200);
  return content.replace(/\s+/g, " ").trim().slice(0, 200);
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

const STALE_STAGE_AGE_MS = 60 * 60 * 1000; // 1 hour

function stageTmpDirName(): string {
  return `.tmp-stage-${process.pid}-${process.hrtime.bigint()}`;
}

function stageOldDirName(): string {
  return `.old-stage-${process.pid}-${process.hrtime.bigint()}`;
}

/**
 * Sweep stale `.tmp-stage-*` and `.old-stage-*` dirs from prior crashed runs.
 * Only removes dirs older than `ageThresholdMs` (default 1 hour) to avoid
 * clobbering a concurrent run.
 *
 * The 1h threshold covers normal operation. If a process is suspended
 * (SIGSTOP, laptop sleep >1h) its tmpDir may be swept by a concurrent run;
 * this is acceptable as the suspended process would observe its own tmpDir
 * missing and fail cleanly on the next rename. A future hardening pass could
 * write a .pid lockfile inside tmpDir and check liveness on cleanup.
 */
async function cleanupStaleStageDirs(
  liveDir: string,
  ageThresholdMs: number = STALE_STAGE_AGE_MS,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(liveDir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(".tmp-stage-") && !name.startsWith(".old-stage-")) continue;
    const fullPath = join(liveDir, name);
    try {
      const s = await stat(fullPath);
      if (now - s.mtimeMs > ageThresholdMs) {
        await rm(fullPath, { recursive: true, force: true });
      }
    } catch {
      // Entry disappeared or unreadable — skip.
    }
  }
}

/**
 * Atomically swap tmpDir contents into liveDir. Moves existing liveDir
 * entries (except .cache and .tmp-stage-* / .old-stage-*) into oldDir,
 * then moves tmpDir entries into liveDir, then removes oldDir.
 *
 * If a partial swap fails after some renames have completed, both tmpDir and
 * oldDir are left in place. The next run's `cleanupStaleStageDirs` (1h age
 * threshold) will sweep them. Manual recovery: move the contents of the
 * .old-stage-* directory (sources/, repos/, _manifest.json) back into the
 * agent's knowledge root to restore prior state.
 *
 * Throws on EXDEV (cross-device rename) with a clear message.
 */
async function swapStageIntoLive(
  liveDir: string,
  tmpDir: string,
  oldDir: string,
): Promise<string[]> {
  const warnings: string[] = [];
  await mkdir(oldDir, { recursive: true });

  // Move existing liveDir entries (except .cache and staging dirs) into oldDir
  const liveEntries = await readdir(liveDir);
  for (const name of liveEntries) {
    if (name === ".cache") continue;
    if (name.startsWith(".tmp-stage-") || name.startsWith(".old-stage-")) continue;
    try {
      await rename(join(liveDir, name), join(oldDir, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error(
          `EXDEV: cannot rename across devices (${join(liveDir, name)} → ${join(oldDir, name)}). ` +
            "tmpDir and liveDir must be on the same filesystem.",
        );
      }
      throw err;
    }
  }

  // Move tmpDir entries into liveDir
  const tmpEntries = await readdir(tmpDir);
  for (const name of tmpEntries) {
    try {
      await rename(join(tmpDir, name), join(liveDir, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error(
          `EXDEV: cannot rename across devices (${join(tmpDir, name)} → ${join(liveDir, name)}). ` +
            "tmpDir and liveDir must be on the same filesystem.",
        );
      }
      throw err;
    }
  }

  // Remove oldDir and tmpDir (best-effort)
  try {
    await rm(oldDir, { recursive: true, force: true });
  } catch (err) {
    warnings.push(`failed to remove old stage dir: ${toMessage(err)}`);
  }
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // tmpDir should be empty after moves; ignore
  }

  return warnings;
}

export async function runKnowledgeStage(
  block: KnowledgeBlock | undefined,
  paths: PipelinePaths,
  opts: RunKnowledgeStageOpts = {},
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const liveDir = paths.knowledgeDir;

  // Step 1: ensure liveDir exists.
  await mkdir(liveDir, { recursive: true });

  // Step 2: sweep stale staging dirs from prior crashed runs.
  await cleanupStaleStageDirs(liveDir);

  const sources = block?.sources ?? [];
  if (sources.length === 0) {
    const empty: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: new Date().toISOString(),
      sources: [],
      totals: {
        tokensInline: 0,
        tokensInlineBudget: block?.inlineBudget?.totalTokens ?? DEFAULT_INLINE_BUDGET,
        files: 0,
        bytes: 0,
      },
    };
    // Even with no sources, swap to clean up stale content from prior runs.
    const tmpDir = join(liveDir, stageTmpDirName());
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "_manifest.json"), JSON.stringify(empty, null, 2));
    const oldDir = join(liveDir, stageOldDirName());
    const swapWarnings = await swapStageIntoLive(liveDir, tmpDir, oldDir);
    warnings.push(...swapWarnings);
    return {
      manifest: empty,
      section: { inline: [], index: [], rootDir: liveDir },
      warnings,
      errors,
    };
  }

  // Step 3: create tmpDir for this run.
  const tmpDir = join(liveDir, stageTmpDirName());
  await mkdir(tmpDir, { recursive: true });

  let swapStarted = false;
  try {
    // Phase 1: acquire + materialize per source into tmpDir.
    const processed: ProcessedSource[] = [];
    for (const src of sources) {
      // Lazy URL sources skip acquire+materialize entirely. The pipeline
      // emits a manifest entry with delivery: "lazy" so downstream
      // consumers (assembler, compile-stanza, doctor) recognize the kind.
      if (isLazyUrlSource(src)) {
        const lazyWarnings = lazyDescriptionWarnings(src);
        for (const w of lazyWarnings) warnings.push(w);
        processed.push({
          declared: src,
          effectiveDelivery: "lazy",
          artifacts: [],
          materializedTexts: [],
          warnings: lazyWarnings,
        });
        continue;
      }
      try {
        const { artifacts, warnings: srcWarnings } = await acquireSource(src, {
          bundleDir: paths.bundleDir,
          cacheDir: paths.cacheDir,
          ...(opts.gitSpawner ? { gitSpawner: opts.gitSpawner } : {}),
          ...(opts.mcpPool ? { mcpPool: opts.mcpPool } : {}),
          ...(opts.spawnOptsFor ? { spawnOptsFor: opts.spawnOptsFor } : {}),
          ...(opts.routeCache !== undefined ? { routeCache: opts.routeCache } : {}),
          ...(opts.metaClaims !== undefined ? { metaClaims: opts.metaClaims } : {}),
          ...(opts.probeOnFailure ? { probeOnFailure: opts.probeOnFailure } : {}),
          ...(opts.recordRoute ? { recordRoute: opts.recordRoute } : {}),
        });
        const materializedTexts: ProcessedSource["materializedTexts"] = [];
        for (const a of artifacts) {
          const m = chooseMaterializer(src, a);
          const r = runMaterializer(m, a);
          srcWarnings.push(...r.warnings);
          materializedTexts.push({ artifact: a, content: r.content });
        }
        processed.push({
          declared: src,
          effectiveDelivery:
            src.delivery === "inline" ? "inline" : src.delivery === "file" ? "file" : "inline",
          artifacts,
          materializedTexts,
          warnings: srcWarnings,
        });
        warnings.push(...srcWarnings.map((w) => `[${src.id}] ${w}`));
      } catch (err) {
        const message =
          err instanceof SmithError && err.payload.code === "validation-failed"
            ? `${err.payload.what}: ${err.payload.reasons.join("; ")}`
            : toMessage(err);
        if (src.optional) {
          warnings.push(`[${src.id}] optional source failed: ${message}`);
        } else {
          errors.push(`[${src.id}] ${message}`);
        }
      }
    }

    // Phase 2: choose effective delivery for `auto`, apply inline budget.
    const totalBudget = block?.inlineBudget?.totalTokens ?? DEFAULT_INLINE_BUDGET;
    let usedTokens = 0;

    for (const p of processed) {
      // Lazy was set in Phase 1; nothing to decide.
      if (p.effectiveDelivery === "lazy") continue;
      const totalChars = p.materializedTexts.reduce((n, x) => n + x.content.length, 0);
      const cheapTokenLowerBound = Math.ceil(totalChars / 8);
      const remainingBudget = totalBudget - usedTokens;
      const declaredCap = p.declared.inlineBudgetTokens ?? remainingBudget;
      const exceedsCheaply =
        cheapTokenLowerBound > declaredCap || cheapTokenLowerBound > remainingBudget;
      const totalTokens = exceedsCheaply
        ? cheapTokenLowerBound
        : p.materializedTexts.reduce((n, x) => n + estimateTokens(x.content), 0);
      const declared = p.declared.delivery;
      if (declared === "auto") {
        const perSource = p.declared.inlineBudgetTokens ?? Math.min(2000, totalBudget - usedTokens);
        if (
          p.artifacts.length === 1 &&
          totalTokens <= perSource &&
          totalTokens <= totalBudget - usedTokens
        ) {
          p.effectiveDelivery = "inline";
        } else {
          p.effectiveDelivery = "file";
        }
      }
      if (p.effectiveDelivery === "inline") {
        const cap = p.declared.inlineBudgetTokens ?? totalBudget - usedTokens;
        if (totalTokens > cap || usedTokens + totalTokens > totalBudget) {
          const tokenLabel = exceedsCheaply ? `≥${totalTokens}` : `${totalTokens}`;
          warnings.push(
            `[${p.declared.id}] inline tokens (${tokenLabel}) exceed remaining budget (${remainingBudget}); demoted to file delivery`,
          );
          p.effectiveDelivery = "file";
        } else {
          usedTokens += totalTokens;
        }
      }
    }

    // Phase 3: write to tmpDir + build section + manifest entries.
    const section: KnowledgeSection = { inline: [], index: [], rootDir: liveDir };
    const manifestSources: KnowledgeManifestSourceEntry[] = [];
    let totalFiles = 0;
    let totalBytes = 0;

    for (const p of processed) {
      // Lazy sources have no on-disk artifact and no inline body.
      if (p.effectiveDelivery === "lazy") {
        const provenance: { url?: string } = {};
        if (p.declared.type === "webpage") provenance.url = p.declared.url;
        manifestSources.push({
          id: p.declared.id,
          scope: "agent",
          type: p.declared.type,
          ...(p.declared.type === "webpage" ? { url: p.declared.url } : {}),
          ...(Object.keys(provenance).length > 0 ? { source: provenance } : {}),
          delivery: "lazy",
          files: [],
          fetchedAt: new Date().toISOString(),
          extractor: null,
          tokensInline: 0,
          ...(p.declared.description ? { description: p.declared.description } : {}),
          ...(p.declared.summary !== undefined ? { summary: p.declared.summary } : {}),
          ...(p.declared.toc !== undefined ? { toc: p.declared.toc } : {}),
          ...(p.declared.retrieval !== undefined ? { retrieval: p.declared.retrieval } : {}),
        });
        continue;
      }
      const srcDir = join(tmpDir, "sources", p.declared.id);
      await mkdir(srcDir, { recursive: true });
      const files: MaterializedFile[] = [];
      const inlineParts: string[] = [];

      for (const { artifact, content } of p.materializedTexts) {
        const outRel = artifact.relPath || artifact.filename;
        const absOut = join(srcDir, outRel);
        await assertWithin(absOut, srcDir);
        await mkdir(dirname(absOut), { recursive: true });
        await writeFile(absOut, content, "utf8");
        const bytes = Buffer.byteLength(content, "utf8");
        const file: MaterializedFile = {
          relPath: join("sources", p.declared.id, outRel).replaceAll("\\", "/"),
          bytes,
          sha256: sha256(content),
          summary: summarize(content),
        };
        files.push(file);
        totalFiles += 1;
        totalBytes += bytes;
        if (p.effectiveDelivery === "inline") inlineParts.push(content);
      }

      const tokensInline =
        p.effectiveDelivery === "inline" ? estimateTokens(inlineParts.join("\n\n")) : 0;

      const provenance: { url?: string; path?: string } = {};
      if ("url" in p.declared && p.declared.url) provenance.url = p.declared.url;
      if ("path" in p.declared && p.declared.path) provenance.path = p.declared.path;

      manifestSources.push({
        id: p.declared.id,
        scope: "agent",
        type: p.declared.type,
        ...(Object.keys(provenance).length > 0 ? { source: provenance } : {}),
        delivery: p.effectiveDelivery,
        files: files.map((f) => ({
          path: f.relPath,
          sha256: f.sha256,
          bytes: f.bytes,
          ...(f.summary ? { summary: f.summary } : {}),
        })),
        fetchedAt: new Date().toISOString(),
        extractor: null,
        tokensInline,
        ...(p.declared.description ? { description: p.declared.description } : {}),
        ...(p.declared.summary !== undefined ? { summary: p.declared.summary } : {}),
        ...(p.declared.toc !== undefined ? { toc: p.declared.toc } : {}),
        ...(p.declared.retrieval !== undefined ? { retrieval: p.declared.retrieval } : {}),
      });

      if (p.effectiveDelivery === "inline") {
        section.inline.push({
          id: p.declared.id,
          ...(p.declared.description ? { description: p.declared.description } : {}),
          content: inlineParts.join("\n\n---\n\n"),
        });
      } else {
        for (const f of files) {
          section.index.push({
            id: p.declared.id,
            relPath: f.relPath,
            ...(p.declared.description ? { description: p.declared.description } : {}),
            ...(f.summary ? { summary: f.summary } : {}),
          });
        }
      }
    }

    section.hasGitSources = processed.some((p) => p.declared.type === "git");
    section.sourceTypes = new Set(processed.map((p) => p.declared.type));

    // Step 5: write manifest into tmpDir.
    const manifest: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: new Date().toISOString(),
      sources: manifestSources,
      totals: {
        tokensInline: usedTokens,
        tokensInlineBudget: totalBudget,
        files: totalFiles,
        bytes: totalBytes,
      },
    };
    await writeFile(join(tmpDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

    // Step 6: cache GC (independent of swap success).
    const currentGitIds = new Set(
      processed.filter((p) => p.declared.type === "git").map((p) => p.declared.id),
    );
    const currentGitKeys = new Set(
      sources
        .filter((s): s is Extract<KnowledgeSource, { type: "git" }> => s.type === "git")
        .map((s) => urlCacheKey(s.url)),
    );
    const currentUrlKeys = new Set(
      sources
        .filter(
          (s): s is Extract<KnowledgeSource, { type: "webpage" | "web" }> =>
            s.type === "webpage" || s.type === "web",
        )
        .map((s) => urlCacheKey(s.url)),
    );
    const cacheSweep = await sweepStaleCacheEntries(paths.cacheDir, currentGitKeys, currentUrlKeys);
    warnings.push(...cacheSweep.warnings);

    // Step 7: if errors, rm tmpDir and return without touching liveDir.
    if (errors.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
      return { manifest, section, warnings, errors };
    }

    // Step 8: atomic swap — move liveDir entries into oldDir, then tmpDir into liveDir.
    const oldDir = join(liveDir, stageOldDirName());
    swapStarted = true;
    const swapWarnings = await swapStageIntoLive(liveDir, tmpDir, oldDir);
    warnings.push(...swapWarnings);

    // Step 8 (cont): recreate repos/<id> symlinks AFTER swap (target paths now stable).
    const sweepResult = await sweepStaleRepoSymlinks(liveDir, currentGitIds);
    warnings.push(...sweepResult.warnings);

    for (const p of processed) {
      if (p.declared.type === "git") {
        const hashDir = join(paths.cacheDir, "git", urlCacheKey(p.declared.url));
        const linkPath = join(liveDir, "repos", p.declared.id);
        try {
          await ensureRelativeSymlink(linkPath, hashDir);
        } catch (err) {
          warnings.push(
            `[${p.declared.id}] repo symlink creation failed: ${toMessage(err)} — full checkout still available at ${hashDir}`,
          );
        }
      }
    }

    // Step 9 (v2.1): smart compile default. Compile when explicitly opted in
    // OR when the materialized corpus exceeds the inline budget (the same knob
    // that gates v1 silent truncation). Explicit `compile.progressive: false`
    // pins the v1 path even for large bundles.
    const compileExplicit = block?.compile?.progressive;
    const compileShouldRun =
      compileExplicit === true || (compileExplicit !== false && shouldAutoCompile(manifest, block));
    let compiled: CompiledKnowledge | undefined;
    if (compileShouldRun) {
      compiled = await compileFromManifest(manifest, block, paths.knowledgeDir);
      for (const w of compiled.warnings) warnings.push(w);
    }

    // Build the hybrid search index over the freshly materialized tree. Runs
    // here (single-writer install path) so the serve process only ever reads.
    // Never throws; degrades to in-memory BM25 at serve time on failure.
    const hybridSourceIds = new Set(
      manifest.sources.filter((s) => s.retrieval?.mode === "hybrid").map((s) => s.id),
    );
    const indexWarnings = await buildIndexInto(liveDir, null, hybridSourceIds); // full build on (re)install
    for (const w of indexWarnings) warnings.push(w);

    return {
      manifest,
      section,
      warnings,
      errors,
      ...(compiled ? { compiled } : {}),
    };
  } catch (err) {
    // If swap hasn't started, tmpDir is safe to remove. If swap started,
    // leave tmpDir + oldDir for cleanupStaleStageDirs to handle on next run.
    if (!swapStarted) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    throw err;
  }
}

/**
 * Shared helper: compile a `KnowledgeManifest` (in-memory or freshly read
 * from disk) into a `CompiledKnowledge` and persist `compile-manifest.json`.
 *
 * Used by both the live acquire+materialize path (`runKnowledgeStage`) and
 * the offline `runCompileFromMaterialized` path. Keeps the projection from
 * `KnowledgeManifestSourceEntry` → `MaterializedSource` in one place so the
 * two paths can never drift.
 */
async function compileFromManifest(
  manifest: KnowledgeManifest,
  block: KnowledgeBlock | undefined,
  knowledgeDir: string,
  opts: { writeManifest?: boolean } = {},
): Promise<CompiledKnowledge> {
  const compileOpts = buildCompileOptionsFromBundle(block);
  const matSources: MaterializedSource[] = manifest.sources.map((s) => ({
    id: s.id,
    scope: s.scope,
    type: s.type,
    delivery: s.delivery,
    files: s.files.map((f) => ({
      relPath: f.path,
      bytes: f.bytes,
      sha256: f.sha256,
      ...(f.summary ? { summary: f.summary } : {}),
    })),
    tokensInline: s.tokensInline,
    ...(s.description !== undefined ? { description: s.description } : {}),
    ...(s.source ? { source: s.source } : {}),
    ...(s.fetchedAt ? { fetchedAt: s.fetchedAt } : {}),
    ...(s.summary !== undefined ? { summary: s.summary } : {}),
    ...(s.toc !== undefined ? { toc: s.toc } : {}),
    ...(s.retrieval !== undefined ? { retrieval: s.retrieval } : {}),
  }));
  const compiled = compile(matSources, compileOpts, { rootDir: knowledgeDir });
  if (opts.writeManifest !== false) {
    await writeCompileManifest(knowledgeDir, compiled.manifest);
  }
  return compiled;
}

/**
 * Paths required by `runCompileFromMaterialized`.
 *
 * `cacheDir` is accepted but unused: compile-from-materialized never touches
 * the cache. It's part of the signature so callers can pass `PipelinePaths`
 * verbatim without conditional spread, and so a future helper can opt into
 * cache-aware behaviour without breaking the API.
 */
export interface RunCompileFromMaterializedOpts {
  bundleDir: string;
  knowledgeDir: string;
  cacheDir: string;
  /**
   * When false, skip persisting `compile-manifest.json` to disk. Used by the
   * GUI's drift-check dry-run path, which reads materialized state but must
   * not touch the filesystem (the contract is "read what install would
   * produce, hash it, compare"). Default: true (current behaviour, the CLI
   * compile command always wants the persisted side effect).
   */
  writeManifest?: boolean;
}

/**
 * Offline compile: re-derive `compile-manifest.json` from already-materialized
 * sources without re-acquiring from network/MCP/disk. The materialized files
 * and `_manifest.json` are produced by a prior `smith knowledge fetch` or
 * `smith agent install`; this function reads them in place.
 *
 * Compile is a re-derivation operation — given the same materialized inputs
 * it produces the same compile manifest. It must be cheap, pure, and offline:
 *
 *   - No MCP servers spawned.
 *   - No network calls.
 *   - The `<knowledgeDir>/sources/` tree is read but never mutated.
 *   - No routing options (mcpPool / spawnOptsFor / routeCache / metaClaims /
 *     probeOnFailure / recordRoute) are accepted; routing happens at fetch
 *     time, not compile time.
 *
 * Sources declared in `block.sources` that have no entry in the live
 * `_manifest.json` are reported as errors with a clear "run smith knowledge
 * fetch first" hint. The `_manifest.json` itself missing is treated the same
 * way — the agent has never had its knowledge materialized.
 */
export async function runCompileFromMaterialized(
  block: KnowledgeBlock | undefined,
  opts: RunCompileFromMaterializedOpts,
): Promise<PipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const liveDir = opts.knowledgeDir;

  const sources = block?.sources ?? [];
  const totalBudget = block?.inlineBudget?.totalTokens ?? DEFAULT_INLINE_BUDGET;

  // No declared sources: behave like `runKnowledgeStage`'s empty-sources path
  // — return an empty manifest + section, no compile output.
  if (sources.length === 0) {
    const empty: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: new Date().toISOString(),
      sources: [],
      totals: {
        tokensInline: 0,
        tokensInlineBudget: totalBudget,
        files: 0,
        bytes: 0,
      },
    };
    return {
      manifest: empty,
      section: { inline: [], index: [], rootDir: liveDir },
      warnings,
      errors,
    };
  }

  // Read the live manifest written by a prior fetch/install. ENOENT means the
  // agent has never been materialized; report a clear actionable error per
  // declared source rather than failing opaquely.
  const manifestPath = join(liveDir, "_manifest.json");
  let liveManifest: KnowledgeManifest | undefined;
  try {
    const raw = await readFile(manifestPath, "utf8");
    liveManifest = JSON.parse(raw) as KnowledgeManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: KnowledgeManifest = {
        schemaVersion: 1,
        renderedAt: new Date().toISOString(),
        sources: [],
        totals: {
          tokensInline: 0,
          tokensInlineBudget: totalBudget,
          files: 0,
          bytes: 0,
        },
      };
      for (const src of sources) {
        errors.push(`[${src.id}] no materialized files found; run \`smith knowledge fetch\` first`);
      }
      return {
        manifest: empty,
        section: { inline: [], index: [], rootDir: liveDir },
        warnings,
        errors,
      };
    }
    throw new SmithError({
      code: "validation-failed",
      what: `_manifest.json at ${manifestPath}`,
      reasons: [toMessage(err)],
    });
  }

  // Re-derive section + per-source manifest entries by intersecting declared
  // sources with the live manifest. Sources missing from the live manifest are
  // reported as errors; sources present but with zero files (degenerate state)
  // are warned and omitted from the compile.
  const section: KnowledgeSection = { inline: [], index: [], rootDir: liveDir };
  const manifestSources: KnowledgeManifestSourceEntry[] = [];
  let totalFiles = 0;
  let totalBytes = 0;
  let usedTokens = 0;

  const liveById = new Map<string, KnowledgeManifestSourceEntry>(
    liveManifest.sources.map((s) => [s.id, s]),
  );

  for (const declared of sources) {
    const live = liveById.get(declared.id);
    if (!live) {
      errors.push(
        `[${declared.id}] no materialized files found; run \`smith knowledge fetch\` first`,
      );
      continue;
    }

    // Sanity-check materialized files exist on disk. A missing file in the
    // sources/ tree indicates a partial swap or out-of-band deletion; surface
    // it as an error so the user runs fetch to repair, rather than producing
    // a compile manifest that points at vanished content.
    let missingFile = false;
    for (const f of live.files) {
      const abs = join(liveDir, f.path);
      try {
        await stat(abs);
      } catch {
        errors.push(
          `[${declared.id}] materialized file missing on disk: ${f.path}; run \`smith knowledge fetch\` to repair`,
        );
        missingFile = true;
        break;
      }
    }
    if (missingFile) continue;

    // Carry forward the live manifest entry but freshen `renderedAt` semantics
    // by overlaying the declared block's optional knobs (description, summary,
    // toc, retrieval) so iteration on those bundle-side fields takes effect on
    // compile without a re-fetch.
    const provenance: { url?: string; path?: string } = {};
    if ("url" in declared && declared.url) provenance.url = declared.url;
    if ("path" in declared && declared.path) provenance.path = declared.path;
    const entry: KnowledgeManifestSourceEntry = {
      id: declared.id,
      scope: live.scope,
      type: declared.type,
      ...(Object.keys(provenance).length > 0
        ? { source: provenance }
        : live.source
          ? { source: live.source }
          : {}),
      delivery: live.delivery,
      files: live.files,
      ...(live.fetchedAt ? { fetchedAt: live.fetchedAt } : {}),
      extractor: live.extractor ?? null,
      tokensInline: live.tokensInline,
      ...(declared.description !== undefined
        ? { description: declared.description }
        : live.description !== undefined
          ? { description: live.description }
          : {}),
      ...(declared.summary !== undefined
        ? { summary: declared.summary }
        : live.summary !== undefined
          ? { summary: live.summary }
          : {}),
      ...(declared.toc !== undefined
        ? { toc: declared.toc }
        : live.toc !== undefined
          ? { toc: live.toc }
          : {}),
      ...(declared.retrieval !== undefined
        ? { retrieval: declared.retrieval }
        : live.retrieval !== undefined
          ? { retrieval: live.retrieval }
          : {}),
    };
    manifestSources.push(entry);
    totalFiles += live.files.length;
    totalBytes += live.files.reduce((n, f) => n + f.bytes, 0);
    usedTokens += live.tokensInline;

    // Rebuild the section so callers that consume `section` (e.g. assembler
    // dry-runs) get a coherent view. Inline content is read from disk so we
    // don't depend on the materialized files being kept in memory.
    if (live.delivery === "inline") {
      const parts: string[] = [];
      for (const f of live.files) {
        const abs = join(liveDir, f.path);
        try {
          parts.push(await readFile(abs, "utf8"));
        } catch (err) {
          warnings.push(`[${declared.id}] failed to read inline file ${f.path}: ${toMessage(err)}`);
        }
      }
      section.inline.push({
        id: declared.id,
        ...(declared.description ? { description: declared.description } : {}),
        content: parts.join("\n\n---\n\n"),
      });
    } else {
      for (const f of live.files) {
        section.index.push({
          id: declared.id,
          relPath: f.path,
          ...(declared.description ? { description: declared.description } : {}),
          ...(f.summary ? { summary: f.summary } : {}),
        });
      }
    }
  }

  section.hasGitSources = manifestSources.some((s) => s.type === "git");
  section.sourceTypes = new Set(manifestSources.map((s) => s.type));

  const manifest: KnowledgeManifest = {
    schemaVersion: 1,
    renderedAt: liveManifest.renderedAt,
    sources: manifestSources,
    totals: {
      tokensInline: usedTokens,
      tokensInlineBudget: totalBudget,
      files: totalFiles,
      bytes: totalBytes,
    },
  };

  // If any source failed, return without producing a compile manifest. The
  // caller surfaces `result.errors` so the user sees the "run fetch first"
  // hint per source.
  if (errors.length > 0) {
    return { manifest, section, warnings, errors };
  }

  // Compile is forced for this offline path: callers (CLI compile command)
  // explicitly asked for it. Honor that the same way the live path does when
  // `compile.progressive: true` is set.
  const compiled = await compileFromManifest(manifest, block, liveDir, {
    ...(opts.writeManifest !== undefined ? { writeManifest: opts.writeManifest } : {}),
  });
  for (const w of compiled.warnings) warnings.push(w);

  return {
    manifest,
    section,
    warnings,
    errors,
    compiled,
  };
}
