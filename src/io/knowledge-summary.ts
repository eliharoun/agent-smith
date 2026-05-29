import { readFile } from "node:fs/promises";
import type { KnowledgeManifest } from "../core/knowledge/types";

export interface KnowledgeSourceSummary {
  id: string;
  delivery: "inline" | "file";
  files: number;
  bytes: number;
  changed: boolean;
}

export interface KnowledgeSummary {
  agent: string;
  sources: KnowledgeSourceSummary[];
  totals: {
    files: number;
    bytes: number;
    tokensInline: number;
    tokensInlineBudget: number;
    /** True iff at least one source has delivery="inline". Drives whether the
     * tally shows the `inline tokens X/Y` clause. */
    hasInline: boolean;
  };
}

export interface SummarizeKnowledgeStageOptions {
  agent: string;
  currentManifest: KnowledgeManifest;
  /** DI seam. Default reads `<knowledgeDir>/_manifest.json` and JSON.parses;
   * returns null on ENOENT, parse error, or any other read failure. */
  readPriorManifest: () => Promise<KnowledgeManifest | null>;
}

/**
 * Diff the current manifest against the prior to compute a per-source
 * `changed` bit for install-output display. A source is unchanged iff the
 * prior manifest had an entry with the same `id`, the same `delivery`, and
 * the same set of `{path, sha256}` tuples for its files. Otherwise changed.
 * No prior manifest → all sources changed.
 */
export async function summarizeKnowledgeStage(
  opts: SummarizeKnowledgeStageOptions,
): Promise<KnowledgeSummary> {
  const prior = await opts.readPriorManifest();
  const priorById = new Map(
    (prior?.sources ?? []).map((s) => [s.id, s]),
  );

  const sources: KnowledgeSourceSummary[] = opts.currentManifest.sources.map((s) => {
    // The source's `delivery` in the current manifest is always "inline" or "file" —
    // "auto" is resolved by the pipeline before write. Narrowing here is a defensive
    // assertion; if "auto" ever leaked through, treating it as "file" is the safer
    // default for a presentation layer.
    const delivery: "inline" | "file" = s.delivery === "inline" ? "inline" : "file";
    const bytes = s.files.reduce((n, f) => n + f.bytes, 0);
    const prev = priorById.get(s.id);
    let changed = true;
    if (prev && prev.delivery === s.delivery && prev.files.length === s.files.length) {
      const currentKeys = new Set(s.files.map((f) => `${f.path}\u0000${f.sha256}`));
      const allMatch = prev.files.every((f) =>
        currentKeys.has(`${f.path}\u0000${f.sha256}`),
      );
      if (allMatch) changed = false;
    }
    return { id: s.id, delivery, files: s.files.length, bytes, changed };
  });

  const hasInline = sources.some((s) => s.delivery === "inline");
  return {
    agent: opts.agent,
    sources,
    totals: {
      files: opts.currentManifest.totals.files,
      bytes: opts.currentManifest.totals.bytes,
      tokensInline: opts.currentManifest.totals.tokensInline,
      tokensInlineBudget: opts.currentManifest.totals.tokensInlineBudget,
      hasInline,
    },
  };
}

/**
 * Production default for `readPriorManifest`: best-effort read of
 * `<knowledgeDir>/_manifest.json`. Returns null on ANY failure (ENOENT,
 * invalid JSON, etc.). Presentation must not crash the install on a
 * stale/corrupt prior manifest. EACCES and other unexpected errors are
 * also swallowed deliberately — the install/materialize path owns
 * disk-health diagnostics.
 */
export function defaultReadPriorManifest(
  priorManifestPath: string,
): () => Promise<KnowledgeManifest | null> {
  return async () => {
    try {
      const raw = await readFile(priorManifestPath, "utf8");
      return JSON.parse(raw) as KnowledgeManifest;
    } catch {
      return null;
    }
  };
}
