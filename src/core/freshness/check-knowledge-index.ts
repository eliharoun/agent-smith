/**
 * Doctor's read-only knowledge-index detection.
 *
 * For each candidate agent, classify the on-disk search index:
 *   - stale-index:   indexDbPath exists but a readonly KnowledgeStore.open at
 *                    the current SCHEMA_VERSION returns null (schema mismatch or
 *                    corruption). Auto-repairable via `--fix-knowledge-index`,
 *                    which rebuilds it with buildIndexInto.
 *   - missing-index: indexDbPath is absent but the agent has materialized,
 *                    indexable content (≥1 source with ≥1 file in
 *                    `_manifest.json`). NOT auto-repaired — reported with a
 *                    suggested `smith agent install <agent>` so the user (not a
 *                    health check) pays any embedding-model cost on a real install.
 *
 * Healthy DBs, agents with no manifest, and agents whose manifest lists only
 * lazy / zero-file sources are skipped. Read-only; never throws on fs absence.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHUNKER_VERSION } from "../knowledge/index/chunker";
import { indexDbPath } from "../knowledge/index/index-paths";
import { MODEL_POLICY_VERSION } from "../knowledge/index/model-policy";
import { REPOMAP_VERSION } from "../knowledge/index/repomap/extract";
import { SCHEMA_VERSION } from "../knowledge/index/schema-version";
import { KnowledgeStore } from "../knowledge/index/store";
import type { KnowledgeManifest } from "../knowledge/types";

export type Finding =
  | { kind: "stale-index"; agent: string }
  | { kind: "missing-index"; agent: string };

export interface KnowledgeIndexReport {
  status: "ok" | "warn";
  findings: Finding[];
}

export interface KnowledgeIndexCandidate {
  /** Agent (bundle.config.name). */
  name: string;
  /** Per-agent knowledge dir, e.g. `<agentSmithHome>/knowledge/<name>`. */
  knowledgeDir: string;
}

export interface CheckKnowledgeIndexInput {
  candidates: KnowledgeIndexCandidate[];
  /**
   * Test seam: override the "is this on-disk index usable?" probe. Defaults to
   * a readonly `KnowledgeStore.open` at the current SCHEMA_VERSION — the same
   * canonical incompatibility check `serve` and `info` use (so the detector
   * can never disagree with them).
   */
  probeIndexUsable?: (dbPath: string) => Promise<boolean>;
}

async function defaultProbeIndexUsable(dbPath: string): Promise<boolean> {
  const store = await KnowledgeStore.open(
    dbPath,
    {
      schemaVersion: SCHEMA_VERSION,
      embedders: [],
      chunkerVersion: CHUNKER_VERSION,
      modelPolicyVersion: MODEL_POLICY_VERSION,
      repomapVersion: REPOMAP_VERSION,
    },
    { readonly: true },
  );
  if (!store) return false;
  store.close();
  return true;
}

export async function checkKnowledgeIndex(
  input: CheckKnowledgeIndexInput,
): Promise<KnowledgeIndexReport> {
  const probe = input.probeIndexUsable ?? defaultProbeIndexUsable;
  const findings: Finding[] = [];
  for (const cand of input.candidates) {
    const dbPath = indexDbPath(cand.knowledgeDir);
    if (existsSync(dbPath)) {
      // DB present: a readonly open that returns false means the on-disk index
      // is unusable (schema mismatch / corruption) → stale-index. A healthy DB
      // is skipped.
      const usable = await probe(dbPath).catch(() => false);
      if (!usable) findings.push({ kind: "stale-index", agent: cand.name });
      continue;
    }
    // No DB on disk: flag missing-index only when the agent has materialized,
    // indexable content (≥1 source with ≥1 file). Lazy sources carry files: []
    // and so are naturally excluded; agents never materialized are skipped.
    const manifest = await readKnowledgeManifest(cand.knowledgeDir);
    if (manifest && manifest.sources.some((s) => (s.files?.length ?? 0) > 0)) {
      findings.push({ kind: "missing-index", agent: cand.name });
    }
  }
  return { status: findings.length === 0 ? "ok" : "warn", findings };
}

/**
 * Read the agent's `_manifest.json`. Returns `undefined` on any failure
 * (missing file, unparseable JSON, off-schema) — absence means "no
 * materialization yet", which is not a finding.
 */
async function readKnowledgeManifest(knowledgeDir: string): Promise<KnowledgeManifest | undefined> {
  try {
    const raw = await readFile(join(knowledgeDir, "_manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as KnowledgeManifest;
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.sources)) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}
