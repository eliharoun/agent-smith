import { buildIndex } from "./build-index";
import { CHUNKER_VERSION } from "./chunker";
import { loadEmbedder } from "./embedder";
import { indexDbPath } from "./index-paths";
import { REPOMAP_VERSION } from "./repomap/extract";
import { KnowledgeStore } from "./store";

/** Build the hybrid index for an agent's knowledge dir. Runs in the install/
 *  refresh process (single writer). Never throws — any failure leaves the
 *  serve path to fall back to in-memory BM25.
 *
 *  Embedder policy (spec §3.9): "Lexical FTS5 is always built regardless;
 *  `hybrid` controls whether vectors are computed." `hybridSourceIds` is the
 *  set of source ids that declared `retrieval: hybrid`. When it is empty we
 *  build lexical-only with the NullEmbedder — no model load, no vectors — which
 *  keeps install/refresh fast and CI hermetic (no ONNX model download). When at
 *  least one source opts in we load the real embedder and `buildIndex` computes
 *  vectors for those sources' chunks only (others stay lexical-only). Everything
 *  still degrades gracefully: if `loadEmbedder` fails it returns the NullEmbedder,
 *  so we fall back to lexical-only rather than blocking the build. The store's
 *  embedder-aware reconcile (§3.2.1) re-embeds hybrid chunks on the next build. */
export async function buildIndexInto(
  knowledgeDir: string,
  changedPaths: string[] | null,
  hybridSourceIds: Set<string> = new Set(),
): Promise<void> {
  try {
    // Load the real embedder only if at least one source opts into hybrid;
    // otherwise stay lexical-only (NullEmbedder) — no model load, fast install.
    const embedder =
      hybridSourceIds.size > 0 ? await loadEmbedder({}) : await loadEmbedder({ forceNull: true });
    const store = await KnowledgeStore.open(indexDbPath(knowledgeDir), {
      schemaVersion: 1,
      embedderId: embedder.id,
      embedderDim: embedder.dim || 1, // 0 -> 1 placeholder for the no-vector (NullEmbedder) case
      chunkerVersion: CHUNKER_VERSION,
      repomapVersion: REPOMAP_VERSION,
    });
    if (!store) return; // store unavailable -> serve falls back to in-memory BM25
    try {
      await buildIndex({ knowledgeDir, store, embedder, changedPaths, hybridSourceIds });
    } finally {
      store.close();
    }
  } catch {
    // never block install/refresh on index build
  }
}
