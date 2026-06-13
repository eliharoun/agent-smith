import type { ChunkKind } from "./store";

export interface ModelRef {
  /** Recorded embedder id (matches Embedder.id, e.g. "<model>@1"). */
  id: string;
  /** HF model path passed to loadEmbedder. */
  modelId: string;
  dim: number;
}

/** Single source of truth for which embedding model serves which chunk kind.
 *  Code → code-specialized model; prose & json → text-specialized model.
 *  Changing these is a model-policy change and must force a full re-embed
 *  (handled later in the build/reconcile layer). */
export const CODE_MODEL: ModelRef = {
  id: "jinaai/jina-embeddings-v2-base-code@1",
  modelId: "jinaai/jina-embeddings-v2-base-code",
  dim: 768,
};
export const TEXT_MODEL: ModelRef = {
  // The transformers.js-packaged build of jina-embeddings-v2-base-en. The
  // upstream `jinaai/...-base-en` repo ships only full-precision ONNX (no
  // `onnx/model_quantized.onnx`), so loading it with dtype "q8" 404s and the
  // embedder silently falls back to NullEmbedder — leaving prose unvectorized.
  // The `Xenova/` mirror is the same 768-dim model with a quantized ONNX.
  id: "Xenova/jina-embeddings-v2-base-en@1",
  modelId: "Xenova/jina-embeddings-v2-base-en",
  dim: 768,
};

/** Bumped whenever the model policy changes — i.e. CODE_MODEL / TEXT_MODEL or
 *  the modelForKind mapping. A change broadly invalidates the index (like a
 *  chunker-version bump) so every chunk re-embeds with the new policy on the
 *  next build, rather than leaving a stale or empty partition that an
 *  incremental refresh wouldn't refill. */
export const MODEL_POLICY_VERSION = 2;

export function modelForKind(kind: ChunkKind): ModelRef {
  return kind === "code" ? CODE_MODEL : TEXT_MODEL;
}

/** Human-facing role label for a recorded embedder id. Used by knowledge info
 *  and knowledge.explain so users see "code"/"prose" rather than raw HF paths.
 *  Unknown ids (e.g. a retired model still in an old index) fall back to the id.
 *  Roles MUST stay unique across models — explain output keys arms by role via
 *  Object.fromEntries, so two ids mapping to the same role would collide. */
export function roleForModelId(id: string): string {
  if (id === CODE_MODEL.id) return "code";
  if (id === TEXT_MODEL.id) return "prose";
  return id;
}

/** All distinct models the policy can produce. */
export const ALL_MODELS: ModelRef[] = [CODE_MODEL, TEXT_MODEL];
