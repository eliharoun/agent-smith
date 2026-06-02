import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentDetail, Target } from "gui-shared";
import { z } from "zod";

const ConfigSchema = z
  .object({
    name: z.string(),
    description: z.string().default(""),
    // The canonical CLI schema (`src/core/config-schema.ts`) uses `modelTier`
    // (enum: "opus"|"sonnet"|"haiku"|"inherit") as the primary model selector,
    // and `model` as an optional override string. Real bundles in the wild
    // (e.g. `~/.config/agent-smith/agents/*/agent.config.json`) ship with
    // `modelTier` only — no `model`. We accept both and let the route flatten
    // them into the GUI's single `model` summary field via `model ?? modelTier`.
    model: z.string().optional(),
    modelTier: z.string().optional(),
    targets: z.array(Target).default([]),
  })
  // .passthrough() preserves unknown keys for forward-compat: GUI servers may
  // encounter bundles authored against a newer CLI schema. Strict mode would
  // break valid bundles. Trade-off: typos in optional keys are silently
  // accepted; CLI strict-mode validation is the source of truth for
  // authoring-time correctness.
  .passthrough();

interface ScanInput {
  name: string;
  catalog: string;
  path: string;
}

export async function scanBundle(input: ScanInput): Promise<AgentDetail> {
  const configPath = join(input.path, "agent.config.json");

  // Use allSettled so a bundle missing multiple files reports them all in a
  // single aggregated error rather than fail-fast on whichever read rejects
  // first. Better UX for partially-installed / corrupted bundles.
  const results = await Promise.allSettled([
    readRequired(join(input.path, "IDENTITY.md")),
    readRequired(join(input.path, "EXPERTISE.md")),
    readRequired(join(input.path, "SOUL.md")),
    readRequired(join(input.path, "USER.md")),
    readRequired(configPath),
  ]);

  const errors: string[] = [];
  const values: (string | undefined)[] = results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    errors.push((r.reason as Error).message);
    return undefined;
  });

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const [identity, expertise, soul, user, configRaw] = values as [
    string,
    string,
    string,
    string,
    string,
  ];

  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw);
  } catch (err) {
    throw new Error(`invalid JSON in ${configPath}: ${(err as Error).message}`);
  }

  let config: z.infer<typeof ConfigSchema>;
  try {
    config = ConfigSchema.parse(configJson);
  } catch (err) {
    throw new Error(`invalid agent.config.json in ${input.path}: ${(err as Error).message}`);
  }

  try {
    return AgentDetail.parse({
      name: input.name,
      description: config.description,
      catalog: input.catalog,
      path: input.path,
      // Prefer the explicit `model` override; fall back to `modelTier`.
      // Bundles authored against the canonical schema set `modelTier`; the
      // GUI surfaces both via the single `model` field on AgentSummary.
      model: config.model ?? config.modelTier,
      targets: config.targets,
      identity,
      expertise,
      soul,
      user,
      config,
    });
  } catch (err) {
    throw new Error(`invalid bundle ${input.path}: ${(err as Error).message}`);
  }
}

async function readRequired(path: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`missing required bundle file: ${path}`);
    }
    throw err;
  }
  if (content.trim().length === 0) {
    throw new Error(`empty required bundle file: ${path}`);
  }
  return content;
}
