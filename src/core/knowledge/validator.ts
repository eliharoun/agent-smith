import type { KnowledgeBlock, KnowledgeSourceType, Materializer } from "./types";
import { isModeAllowedForType, parseRefresh } from "./refresh-spec";
import { getMcpPreset } from "./mcp-presets";

export interface ValidateKnowledgeOpts {
  declaredMcpServers?: string[];
}

export interface KnowledgeValidationResult {
  errors: string[];
  warnings: string[];
}

export const SUPPORTED_TYPES: ReadonlySet<KnowledgeSourceType> = new Set([
  "file",
  "dir",
  "glob",
  "webpage",
  "web",
  "git",
  "confluence",
  "jira",
  "mcp",
]);
const SUPPORTED_MATERIALIZERS: ReadonlySet<Materializer> = new Set([
  "passthrough",
  "markdown",
  "text",
  "html-to-md",
  "json",
]);

export const DEFAULT_INLINE_BUDGET = 8000;
const HARD_INLINE_CEILING = 16000;

export function validateKnowledge(
  block: KnowledgeBlock | undefined,
  opts: ValidateKnowledgeOpts = {},
): KnowledgeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!block) return { errors, warnings };

  if (block.packs && block.packs.length > 0) {
    errors.push(
      "knowledge.packs are not supported yet. Remove the 'packs' field for now. (Design: docs/superpowers/specs/2026-05-03-agent-knowledge-sources-design.md §15 phase 2.)",
    );
  }

  const sources = block.sources ?? [];

  // Duplicate id detection
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.id)) {
      errors.push(`duplicate source id '${s.id}'`);
    }
    seen.add(s.id);
  }

  // Type/materializer gating
  for (const s of sources) {
    if (!SUPPORTED_TYPES.has(s.type)) {
      errors.push(
        `source '${s.id}': type=${s.type} is not supported yet.`,
      );
    }
    if (s.materialize && !SUPPORTED_MATERIALIZERS.has(s.materialize)) {
      errors.push(
        `source '${s.id}': materialize=${s.materialize} is not supported yet.`,
      );
    }
    // refresh validation: per-type mode check + ttl required when mode=ttl.
    if (s.refresh !== undefined) {
      const normalized = parseRefresh(s.refresh);
      if (!isModeAllowedForType(s.type, normalized.mode)) {
        errors.push(
          `source '${s.id}': refresh mode '${normalized.mode}' is not allowed for type=${s.type} (static types only support 'install')`,
        );
      }
      if (normalized.mode === "ttl" && !normalized.ttl) {
        errors.push(
          `source '${s.id}': refresh mode 'ttl' requires a 'ttl' value (e.g. { mode: 'ttl', ttl: '1h' })`,
        );
      }
    }
  }

  // MCP variant advisory warnings
  for (const s of sources) {
    if (s.type !== "mcp") continue;
    const src = s as { server: string; preset?: string };
    if (src.preset && !getMcpPreset(src.preset)) {
      warnings.push(
        `source '${s.id}': preset '${src.preset}' is not a known MCP preset`,
      );
    }
    if (opts.declaredMcpServers && !opts.declaredMcpServers.includes(src.server)) {
      warnings.push(
        `source '${s.id}': MCP server '${src.server}' is not declared in mcp.required/mcp.peer — the agent may not have access at runtime`,
      );
    }
  }

  // Inline budget arithmetic
  const declared = block.inlineBudget?.totalTokens;
  const totalBudget = declared ?? DEFAULT_INLINE_BUDGET;
  if (totalBudget > HARD_INLINE_CEILING) {
    errors.push(
      `inlineBudget.totalTokens=${totalBudget} exceeds hard ceiling ${HARD_INLINE_CEILING}`,
    );
  }
  let sumDeclared = 0;
  for (const s of sources) {
    if (s.delivery !== "inline") continue;
    sumDeclared += s.inlineBudgetTokens ?? 0;
  }
  if (sumDeclared > totalBudget) {
    warnings.push(
      `sum of inline source budgets (${sumDeclared}) exceeds inline budget ${totalBudget}; install will demote oldest-added sources to file delivery`,
    );
  }

  return { errors, warnings };
}
