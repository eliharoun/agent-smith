import { buildIndex } from "./build-index";
import { CHUNKER_VERSION } from "./chunker";
import { embedderCache } from "./embedder";
import { indexDbPath } from "./index-paths";
import { ALL_MODELS, MODEL_POLICY_VERSION } from "./model-policy";
import { REPOMAP_VERSION } from "./repomap/extract";
import { SCHEMA_VERSION } from "./schema-version";
import { KnowledgeStore } from "./store";

/** Build the hybrid index for an agent's knowledge dir. Runs in the install/
 *  refresh process (single writer). Never throws — any failure leaves the
 *  serve path to fall back to in-memory BM25.
 *
 *  Embedder policy (spec §3.9): "Lexical FTS5 is always built regardless;
 *  `hybrid` controls whether vectors are computed." `hybridSourceIds` is the
 *  set of source ids that declared `retrieval: hybrid`. When it is empty we
 *  build lexical-only — no embedder cache, no model load, no vectors — which
 *  keeps install/refresh fast and CI hermetic (no model download). When at least
 *  one source opts in we pass an embedder cache and `buildIndex` routes each
 *  chunk to its per-kind model (code → code model, prose/json → text model),
 *  loading each model lazily on the first chunk of that kind; vectors are
 *  computed for those sources' chunks only (others stay lexical-only).
 *  Everything still degrades gracefully: if a model fails to load the cache
 *  returns the NullEmbedder, so that kind falls back to lexical-only rather than
 *  blocking the build. The store's embedder-aware reconcile (§3.2.1) re-embeds
 *  hybrid chunks on the next build. */
export async function buildIndexInto(
  knowledgeDir: string,
  changedPaths: string[] | null,
  hybridSourceIds: Set<string> = new Set(),
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    // Use an embedder cache only if at least one source opts into hybrid;
    // otherwise stay lexical-only — no model load, fast install.
    const useHybrid = hybridSourceIds.size > 0;
    const cache = useHybrid ? embedderCache() : null;
    const store = await KnowledgeStore.open(
      indexDbPath(knowledgeDir),
      {
        schemaVersion: SCHEMA_VERSION,
        // When any source is hybrid, the build may use any policy model (code +
        // text), routed per chunk kind. List the full policy set so reconcile's
        // per-model clear reasons over them; storedEmbedderIds (live vectors)
        // still reports only models actually present. Lexical-only => [].
        embedders: useHybrid ? ALL_MODELS.map((m) => ({ id: m.id, dim: m.dim })) : [],
        chunkerVersion: CHUNKER_VERSION,
        modelPolicyVersion: MODEL_POLICY_VERSION,
        repomapVersion: REPOMAP_VERSION,
      },
      {
        onNotice: (n) => {
          if (n.kind === "rebuilt") {
            warnings.push("knowledge index reset (incompatible on-disk index discarded and rebuilt)");
          } else if (n.kind === "transient") {
            warnings.push("knowledge index busy; left intact and will retry on the next run");
          } else {
            warnings.push(`knowledge index rebuild failed: ${n.detail}`);
          }
        },
      },
    );
    if (!store) return warnings; // store unavailable -> serve falls back to in-memory BM25
    try {
      await buildIndex({ knowledgeDir, store, embedders: cache, changedPaths, hybridSourceIds });
    } finally {
      store.close();
    }
  } catch (e) {
    // never block install/refresh on index build; surface a warning instead of
    // swallowing so install/fetch is not silent on failure.
    warnings.push(`knowledge index build error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return warnings;
}
