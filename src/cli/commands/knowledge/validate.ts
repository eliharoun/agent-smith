import pc from "picocolors";
import { validateKnowledge } from "../../../core/knowledge/validator";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import {
  aggregateLoadFailures,
  loadAllBundles as defaultLoadAll,
  type LoadAllBundlesResult,
} from "../../load-all";

export interface KnowledgeValidateDeps {
  loadAllBundles: () => Promise<LoadAllBundlesResult>;
}

export async function knowledgeValidate(
  filterAgent?: string,
  deps: KnowledgeValidateDeps = {
    loadAllBundles: async () => loadAllBundles_(),
  },
): Promise<number> {
  const result = await deps.loadAllBundles();
  const bundles = result.bundles.filter(
    (b) => !filterAgent || b.config.name === filterAgent,
  );
  let succeeded = 0;
  const errorDetails: string[] = [];
  for (const b of bundles) {
    const r = validateKnowledge(b.config.knowledge, {
      declaredMcpServers: [
        ...(b.config.mcp?.required ?? []),
        ...(b.config.mcp?.peer ?? []),
        ...(b.config.mcpServers ?? []),
      ],
    });
    if (r.errors.length === 0 && r.warnings.length === 0) {
      succeeded++;
      continue;
    }
    console.log(pc.bold(b.config.name));
    for (const w of r.warnings) console.log(pc.yellow(`  warn: ${w}`));
    if (r.errors.length === 0) {
      succeeded++;
      continue;
    }
    for (const e of r.errors) errorDetails.push(`${b.config.name}: ${e}`);
  }
  const err = aggregateLoadFailures(
    "knowledge validate",
    succeeded,
    result.failures,
    errorDetails,
    errorDetails.length,
  );
  if (err) throw err;
  return 0;
}

async function loadAllBundles_(): Promise<LoadAllBundlesResult> {
  const reg = await loadRegistry(canonicalRegistryPath());
  return defaultLoadAll(reg);
}
