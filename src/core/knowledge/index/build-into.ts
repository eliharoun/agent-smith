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
 *  `hybrid` controls whether vectors are computed." The per-source `hybrid`
 *  retrieval opt-in does not exist yet (Task 8). Until it lands there is
 *  nothing to opt INTO, so we build lexical-only with the NullEmbedder — no
 *  vectors computed. This keeps install/refresh fast (no model load / corpus
 *  embedding) and CI hermetic (no ONNX model download). Task 8 will pass a
 *  real embedder for sources that declare `retrieval: "hybrid"`. The store's
 *  embedder-aware reconcile (§3.2.1) then re-embeds those chunks on next build. */
export async function buildIndexInto(
  knowledgeDir: string,
  changedPaths: string[] | null,
): Promise<void> {
  try {
    const embedder = await loadEmbedder({ forceNull: true });
    const store = await KnowledgeStore.open(indexDbPath(knowledgeDir), {
      schemaVersion: 1,
      embedderId: embedder.id,
      embedderDim: embedder.dim || 1, // 0 -> 1 placeholder for the no-vector (NullEmbedder) case
      chunkerVersion: CHUNKER_VERSION,
      repomapVersion: REPOMAP_VERSION,
    });
    if (!store) return; // store unavailable -> serve falls back to in-memory BM25
    try {
      await buildIndex({ knowledgeDir, store, embedder, changedPaths });
    } finally {
      store.close();
    }
  } catch {
    // never block install/refresh on index build
  }
}
