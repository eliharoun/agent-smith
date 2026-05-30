import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWithin } from "../../io/assert-within";
import { SmithError } from "../smith-error";
import { toMessage } from "../to-message";
import type { AcquiredArtifact, GitSpawner } from "./acquire";
import { urlCacheKey } from "./acquire";
import { acquireSource, chooseMaterializer, runMaterializer } from "./acquire-source";
import {
  ensureRelativeSymlink,
  sweepStaleCacheEntries,
  sweepStaleRepoSymlinks,
} from "./repo-symlinks";
import { estimateTokens } from "./tokens";
import type {
  KnowledgeBlock,
  KnowledgeManifest,
  KnowledgeManifestSourceEntry,
  KnowledgeSection,
  KnowledgeSource,
  MaterializedFile,
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
}

/**
 * Optional dependency-injection hooks for `runKnowledgeStage`. Production
 * callers omit this; tests pass `gitSpawner` to stub git invocations.
 */
export interface RunKnowledgeStageOpts {
  gitSpawner?: GitSpawner;
}

const DEFAULT_INLINE_BUDGET = 8000;

interface ProcessedSource {
  declared: KnowledgeSource;
  effectiveDelivery: "inline" | "file";
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
      try {
        const { artifacts, warnings: srcWarnings } = await acquireSource(src, {
          bundleDir: paths.bundleDir,
          cacheDir: paths.cacheDir,
          ...(opts.gitSpawner ? { gitSpawner: opts.gitSpawner } : {}),
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
        .filter((s): s is Extract<KnowledgeSource, { type: "url" }> => s.type === "url")
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

    return { manifest, section, warnings, errors };
  } catch (err) {
    // If swap hasn't started, tmpDir is safe to remove. If swap started,
    // leave tmpDir + oldDir for cleanupStaleStageDirs to handle on next run.
    if (!swapStarted) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    throw err;
  }
}
