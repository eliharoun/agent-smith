import type { CompileOptions, KnowledgeBlock, KnowledgeSource } from "./types";

/**
 * Build the `CompileOptions` smith uses to run the compile stage for a
 * given bundle. Populates `sourceDeclarations` from `block.sources` so
 * the compile pipeline can read fields like `lazy` and `via` that aren't
 * persisted in the materialized manifest.
 *
 * Two callers must agree on the shape: (1) the CLI compile path
 * (`compileFromManifest` in pipeline.ts), and (2) the doctor's drift
 * detector candidate-builder. Sharing this helper guarantees they
 * produce identical options for the same input bundle, eliminating the
 * non-determinism observed pre-v1.10.1 where doctor saw `c2b7326c` and
 * the CLI saw `dc382422` for bundles with lazy URL sources.
 *
 * Always returns `progressive: true` because both callers operate on
 * already-opted-in bundles by the time they reach this code path.
 */
export function buildCompileOptionsFromBundle(
  block: KnowledgeBlock | undefined,
): CompileOptions {
  const sourceDeclarations: Record<string, KnowledgeSource> = {};
  for (const s of block?.sources ?? []) sourceDeclarations[s.id] = s;
  return {
    progressive: true,
    tocMaxLines: block?.compile?.tocMaxLines ?? 150,
    emitAgentsMd: block?.compile?.emitAgentsMd ?? false,
    sourceDeclarations,
  };
}
