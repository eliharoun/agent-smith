export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dim: number;
  readonly id: string;
}
export class NullEmbedder implements Embedder {
  readonly dim = 0;
  readonly id = "none";
  async embed(_texts: string[]): Promise<Float32Array[]> {
    return [];
  }
}
export interface LoadEmbedderOpts {
  forceNull?: boolean;
  modelId?: string;
  dim?: number;
}
const MODEL_ID = "jinaai/jina-embeddings-v2-base-code";
const MODEL_DIM = 768;
export async function loadEmbedder(opts: LoadEmbedderOpts): Promise<Embedder> {
  if (opts.forceNull) return new NullEmbedder();
  const modelId = opts.modelId ?? MODEL_ID;
  const dim = opts.dim ?? MODEL_DIM;
  try {
    const tf = await import("@huggingface/transformers");
    const pipe = await tf.pipeline("feature-extraction", modelId, { dtype: "q8" });
    return {
      id: `${modelId}@1`,
      dim,
      async embed(texts: string[]): Promise<Float32Array[]> {
        const out: Float32Array[] = [];
        // Per-text for simplicity. The pipeline accepts string[] directly, so a
        // batched path (one call → [N, dim] tensor, sliced per row) is a future
        // optimization for large corpora; per-call is fine at current scale.
        for (const t of texts) {
          const res = await pipe(t, { pooling: "mean", normalize: true });
          // res.data is already an independent buffer (normalize() clones);
          // Float32Array.from copies defensively so each pushed vector is owned.
          out.push(Float32Array.from(res.data as unknown as Iterable<number>));
        }
        return out;
      },
    };
  } catch {
    return new NullEmbedder();
  }
}
export interface EmbedderCache {
  /** Get-or-load an embedder by HF model id. "none" returns a NullEmbedder.
   *  Concurrent calls for the same id share ONE in-flight promise, so the
   *  fire-and-forget serve loop can't trigger duplicate model loads. */
  get(modelId: string, dim?: number): Promise<Embedder>;
}
export function embedderCache(): EmbedderCache {
  const inflight = new Map<string, Promise<Embedder>>();
  return {
    get(modelId: string, dim?: number): Promise<Embedder> {
      const existing = inflight.get(modelId);
      if (existing) return existing;
      const p =
        modelId === "none"
          ? Promise.resolve<Embedder>(new NullEmbedder())
          : loadEmbedder({ modelId, ...(dim !== undefined ? { dim } : {}) });
      inflight.set(modelId, p);
      return p;
    },
  };
}
