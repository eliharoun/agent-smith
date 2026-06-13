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
}
const MODEL_ID = "jinaai/jina-embeddings-v2-base-code";
const MODEL_DIM = 768;
export async function loadEmbedder(opts: LoadEmbedderOpts): Promise<Embedder> {
  if (opts.forceNull) return new NullEmbedder();
  try {
    const tf = await import("@huggingface/transformers");
    const pipe = await tf.pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    return {
      id: `${MODEL_ID}@1`,
      dim: MODEL_DIM,
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
