/**
 * Doctor's read-only knowledge-compile detection.
 *
 * For each agent that opts in to `knowledge.compile.progressive: true`,
 * verify that the persisted `compile-manifest.json` agrees with a fresh
 * `compile()` over the materialized sources recorded in the agent's
 * `_manifest.json`:
 *
 *   - missing-manifest: bundle declares progressive compile but the
 *                       manifest file is absent on disk. Includes the
 *                       "corrupt-manifest" case — `readCompileManifest`
 *                       already returns `undefined` for unparseable or
 *                       off-schema files, and a re-compile is the
 *                       remedy in either case (we conflate for v2.0).
 *   - drift:            persisted contentHash doesn't match a fresh
 *                       compile() over the current materialized sources.
 *
 * Detection is read-only — repair lives in the CLI's
 * `--fix-knowledge-compile` flag which calls `runKnowledgeCompile()` for
 * each missing-manifest / drift finding. This module never throws on
 * filesystem absence: agents that have not yet been materialized at all
 * (no `_manifest.json`) are silently skipped. They will be flagged as
 * `missing-manifest` only after the first materialization writes the
 * sources/manifest pair.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compile } from "../knowledge/compile";
import { readCompileManifest } from "../knowledge/compile-manifest";
import type {
  CompileOptions,
  KnowledgeManifest,
  MaterializedSource,
} from "../knowledge/types";

export type Finding =
  | { kind: "missing-manifest"; agent: string }
  | { kind: "drift"; agent: string; recordedHash: string; currentHash: string };

export interface KnowledgeCompileReport {
  status: "ok" | "warn";
  findings: Finding[];
}

export interface KnowledgeCompileCandidate {
  /** Agent (bundle.config.name). */
  name: string;
  /** Per-agent knowledge dir, e.g. `<agentSmithHome>/knowledge/<name>`. */
  knowledgeDir: string;
  /** Compile options as configured on the bundle. */
  compileOptions: CompileOptions;
}

export interface CheckKnowledgeCompileInput {
  candidates: KnowledgeCompileCandidate[];
}

export async function checkKnowledgeCompile(
  input: CheckKnowledgeCompileInput,
): Promise<KnowledgeCompileReport> {
  const findings: Finding[] = [];
  for (const cand of input.candidates) {
    const manifest = await readKnowledgeManifest(cand.knowledgeDir);
    if (!manifest) {
      // No materialized sources yet → nothing to compare against. The
      // bundle is registered with progressive=true but the user hasn't
      // run `smith knowledge compile` (or `smith agent install` which
      // would materialize) yet. Treat as missing-manifest so the user
      // is prompted to run `smith knowledge compile` (which will both
      // materialize sources and write the compile manifest).
      findings.push({ kind: "missing-manifest", agent: cand.name });
      continue;
    }

    const persisted = await readCompileManifest(cand.knowledgeDir);
    if (!persisted) {
      findings.push({ kind: "missing-manifest", agent: cand.name });
      continue;
    }

    const matSources = materializedSourcesFromManifest(manifest);
    const fresh = compile(matSources, cand.compileOptions, {
      rootDir: cand.knowledgeDir,
    });
    if (fresh.manifest.contentHash !== persisted.contentHash) {
      findings.push({
        kind: "drift",
        agent: cand.name,
        recordedHash: persisted.contentHash,
        currentHash: fresh.manifest.contentHash,
      });
    }
  }
  return {
    status: findings.length === 0 ? "ok" : "warn",
    findings,
  };
}

/**
 * Read the agent's `_manifest.json`. Returns `undefined` for any failure
 * (missing file, unparseable JSON, etc.) — the runner treats absence as
 * "no materialization yet" rather than a hard error.
 */
async function readKnowledgeManifest(
  knowledgeDir: string,
): Promise<KnowledgeManifest | undefined> {
  try {
    const raw = await readFile(join(knowledgeDir, "_manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as KnowledgeManifest;
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.sources)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert the persisted `KnowledgeManifestSourceEntry[]` into the in-memory
 * `MaterializedSource[]` shape `compile()` consumes. This is the same
 * transform `pipeline.ts` performs at compile time (when persisting the
 * compile manifest); duplicating it here avoids re-running the materialize
 * stage just to verify the hash. Any change to that transform must be
 * mirrored here or the doctor will report spurious drift.
 */
function materializedSourcesFromManifest(
  manifest: KnowledgeManifest,
): MaterializedSource[] {
  return manifest.sources.map((s) => ({
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
}
