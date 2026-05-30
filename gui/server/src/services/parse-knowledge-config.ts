import { readFile } from "node:fs/promises";
import { KnowledgeSource } from "gui-shared";
import { z } from "zod";

const ConfigShape = z
  .object({
    knowledge: z
      .object({
        sources: z.array(z.unknown()).optional(),
        inlineBudgetTokens: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .passthrough();

export interface ParseKnowledgeConfigDeps {
  /** Absolute path to <bundleDir>/agent.config.json */
  configPath: string;
}

export interface ParsedKnowledgeConfig {
  sources: z.infer<typeof KnowledgeSource>[];
  invalid: { index: number; error: string }[];
  inlineBudgetTokens?: number;
}

export async function parseKnowledgeConfig(
  deps: ParseKnowledgeConfigDeps,
): Promise<ParsedKnowledgeConfig> {
  let raw: string;
  try {
    raw = await readFile(deps.configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { sources: [], invalid: [] };
    }
    throw err;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { sources: [], invalid: [] };
  }
  const parsedRes = ConfigShape.safeParse(parsedJson);
  if (!parsedRes.success) return { sources: [], invalid: [] };
  const parsed = parsedRes.data;
  const out: ParsedKnowledgeConfig = {
    sources: [],
    invalid: [],
    ...(parsed.knowledge?.inlineBudgetTokens !== undefined && {
      inlineBudgetTokens: parsed.knowledge.inlineBudgetTokens,
    }),
  };
  for (const [i, src] of (parsed.knowledge?.sources ?? []).entries()) {
    const r = KnowledgeSource.safeParse(src);
    if (r.success) out.sources.push(r.data);
    else out.invalid.push({ index: i, error: r.error.message });
  }
  return out;
}
