import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import pc from "picocolors";
import { parseConfig } from "../../../core/config-schema";
import type { KnowledgeBlock } from "../../../core/knowledge/types";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";

export interface KnowledgeRemoveOptions {
  bundleDir: string;
  sourceId: string;
}

/**
 * Remove a knowledge source by id from an agent's `agent.config.json`.
 *
 * Symmetric counterpart to `knowledgeAdd`. Leaves the `knowledge` block in
 * place even when emptied (preserves `packs`, `inlineBudget`, etc.). Returns
 * exit code 0 on success. Throws `SmithError` with code `not-found` when the
 * source id is absent (including when the agent has no knowledge block or
 * no sources array), `config-missing` for ENOENT, and `validation-failed`
 * for malformed JSON.
 *
 * NOTE: Does NOT auto-materialize. Removal does not currently re-run
 * `smith agent install` — installed knowledge files remain on disk until
 * the next install. This mirrors the philosophy of `knowledge add` when
 * `--no-install` is passed.
 */
export async function knowledgeRemove(opts: KnowledgeRemoveOptions): Promise<number> {
  const cfgPath = join(opts.bundleDir, "agent.config.json");
  let raw: string;
  try {
    raw = await readFile(cfgPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError(
        {
          code: "config-missing",
          path: cfgPath,
          suggestedCommand: `smith agent init ${basename(opts.bundleDir)}`,
        },
        { cause: err },
      );
    }
    throw err;
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "agent.config.json",
        reasons: [`${cfgPath}: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }

  const block = (cfg.knowledge as KnowledgeBlock | undefined) ?? undefined;
  const sources = block?.sources ?? [];
  const existingIds = sources.map((s) => s.id);
  if (!existingIds.includes(opts.sourceId)) {
    // Include the list of known ids (if any) so the user can self-correct
    // without re-running `smith knowledge list`. When no sources exist,
    // the headline alone is enough.
    const suggestedCommand =
      existingIds.length > 0
        ? `smith knowledge remove <agent> <one of: ${existingIds.join(", ")}>`
        : `smith knowledge add <agent> <type> <path-or-url>`;
    throw new SmithError({
      code: "not-found",
      what: "knowledge source",
      identifier: opts.sourceId,
      suggestedCommand,
    });
  }

  const remaining = sources.filter((s) => s.id !== opts.sourceId);
  cfg.knowledge = { ...(block ?? {}), sources: remaining };

  // Re-validate the whole config so we never write back an unparseable
  // file (e.g. if the input was already malformed in some non-source
  // way). Removing a source can't *introduce* validation errors that
  // weren't already there, but we still run the gate for symmetry with
  // `knowledgeAdd`.
  const parsed = parseConfig(cfg);
  if (!parsed.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent config (after knowledge remove)",
      reasons: parsed.errors,
    });
  }

  await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  console.log(pc.green("→"), `removed knowledge source ${opts.sourceId}`);
  console.log(
    pc.dim(
      "  note: installed files remain on disk until the next 'smith agent install <agent>'",
    ),
  );
  return 0;
}
