import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SmithError } from "../smith-error";
import { toMessage } from "../to-message";
import { KnowledgeBlockSchema } from "./schema";
import type { KnowledgeBlock } from "./types";

const SIDECAR_FILENAME = "knowledge.json";

/**
 * Load `knowledge.json` from the bundle dir if present, parse + validate against
 * KnowledgeBlockSchema, and merge with the embedded block. Sidecar wins on:
 *  - inlineBudget (whole-object replacement)
 *  - any source whose id matches an embedded source
 *  - packs (whole-array replacement)
 *
 * Returns undefined if neither sidecar nor embedded block is present.
 *
 * On parse or schema failure, throws a `SmithError` with code
 * `validation-failed` and `what: "knowledge sidecar"` so the CLI renders
 * the structured "validation failed" output (with each reason listed)
 * rather than the "unexpected error / file a bug" fallback.
 */
export async function loadAndMergeKnowledge(
  bundleDir: string,
  embedded: KnowledgeBlock | undefined,
): Promise<KnowledgeBlock | undefined> {
  const sidecarPath = join(bundleDir, SIDECAR_FILENAME);
  let sidecar: KnowledgeBlock | undefined;
  try {
    const raw = await readFile(sidecarPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new SmithError(
        {
          code: "validation-failed",
          what: "knowledge sidecar",
          reasons: [`${sidecarPath}: failed to parse as JSON: ${toMessage(err)}`],
        },
        { cause: err },
      );
    }
    const result = KnowledgeBlockSchema.safeParse(parsed);
    if (!result.success) {
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge sidecar",
        reasons: result.error.issues.map(
          (i) => `${sidecarPath}: ${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
      });
    }
    sidecar = result.data as KnowledgeBlock;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      sidecar = undefined;
    } else {
      throw err;
    }
  }

  if (!embedded && !sidecar) return undefined;
  if (!sidecar) return embedded;
  if (!embedded) return sidecar;

  // Merge: sidecar wins on id collisions and on whole-field replacements.
  const merged: KnowledgeBlock = {};
  const packs = sidecar.packs ?? embedded.packs;
  if (packs) merged.packs = packs;
  const inlineBudget = sidecar.inlineBudget ?? embedded.inlineBudget;
  if (inlineBudget) merged.inlineBudget = inlineBudget;
  const byId = new Map<string, NonNullable<KnowledgeBlock["sources"]>[number]>();
  for (const s of embedded.sources ?? []) byId.set(s.id, s);
  for (const s of sidecar.sources ?? []) byId.set(s.id, s);
  if (byId.size > 0) merged.sources = Array.from(byId.values());
  return merged;
}
