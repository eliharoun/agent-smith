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
  id: "jinaai/jina-embeddings-v2-base-en@1",
  modelId: "jinaai/jina-embeddings-v2-base-en",
  dim: 768,
};

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
