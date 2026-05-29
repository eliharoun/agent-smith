import type { CanonicalModelTier } from "../types";

export type ProviderId =
  | "anthropic"
  | "github-copilot"
  | "openrouter"
  | "amazon-bedrock"
  | "google-vertex-ai"
  | "openai";

export interface ProviderTier {
  /** Regex matched against the model id portion AFTER the '<provider>/' prefix. */
  pattern: RegExp;
  /** Curated literal used when live resolution unavailable for this provider. Already includes prefix. */
  curated: string;
}

/**
 * Provider table for v1.0.0-rc.5. Pinned per release. The `pattern` matches
 * candidate models from `opencode models` (the part after '<provider>/').
 * The `curated` value is the full '<provider>/<id>' literal used when live
 * resolution is unavailable.
 *
 * Sourced from public model lists (anthropic.com/api, openai.com/api,
 * github.com/copilot, etc.) on 2026-05-27. Refresh per release.
 */
export const PROVIDER_TABLE_V1_0_0_RC_5: Record<
  Exclude<CanonicalModelTier, "inherit">,
  Partial<Record<ProviderId, ProviderTier>>
> = {
  high: {
    anthropic: { pattern: /^claude-opus-/i, curated: "anthropic/claude-opus-4-7-20260101" },
    "github-copilot": { pattern: /^claude-opus-/i, curated: "github-copilot/claude-opus-4.7" },
    openrouter: {
      pattern: /^anthropic\/claude-opus-/i,
      curated: "openrouter/anthropic/claude-opus-4.7",
    },
    "amazon-bedrock": {
      pattern: /anthropic\.claude-opus-/i,
      curated: "amazon-bedrock/us.anthropic.claude-opus-4-7-v1:0",
    },
    "google-vertex-ai": {
      pattern: /^claude-opus-/i,
      curated: "google-vertex-ai/claude-opus-4-7@20260101",
    },
    openai: { pattern: /^gpt-(5|4\.5)/i, curated: "openai/gpt-5" },
  },
  balanced: {
    anthropic: { pattern: /^claude-sonnet-/i, curated: "anthropic/claude-sonnet-4-6-20260101" },
    "github-copilot": { pattern: /^claude-sonnet-/i, curated: "github-copilot/claude-sonnet-4.6" },
    openrouter: {
      pattern: /^anthropic\/claude-sonnet-/i,
      curated: "openrouter/anthropic/claude-sonnet-4.6",
    },
    "amazon-bedrock": {
      pattern: /anthropic\.claude-sonnet-/i,
      curated: "amazon-bedrock/us.anthropic.claude-sonnet-4-6-v1:0",
    },
    "google-vertex-ai": {
      pattern: /^claude-sonnet-/i,
      curated: "google-vertex-ai/claude-sonnet-4-6@20260101",
    },
    openai: { pattern: /^gpt-(5-mini|4o|4\.1)/i, curated: "openai/gpt-5-mini" },
  },
  fast: {
    anthropic: { pattern: /^claude-haiku-/i, curated: "anthropic/claude-haiku-4-5-20260101" },
    "github-copilot": { pattern: /^claude-haiku-/i, curated: "github-copilot/claude-haiku-4.5" },
    openrouter: {
      pattern: /^anthropic\/claude-haiku-/i,
      curated: "openrouter/anthropic/claude-haiku-4.5",
    },
    "amazon-bedrock": {
      pattern: /anthropic\.claude-haiku-/i,
      curated: "amazon-bedrock/us.anthropic.claude-haiku-4-5-v1:0",
    },
    "google-vertex-ai": {
      pattern: /^claude-haiku-/i,
      curated: "google-vertex-ai/claude-haiku-4-5@20260101",
    },
    openai: { pattern: /^gpt-4o-mini|^gpt-3\.5/i, curated: "openai/gpt-4o-mini" },
  },
};

/**
 * OpenCode's documented provider precedence (https://opencode.ai/docs/providers):
 * "OpenCode prioritizes providers in this order: Copilot > Anthropic > OpenAI."
 * We extend this with the rest of the supported providers in priority order.
 */
export const OPENCODE_PROVIDER_PRECEDENCE: ProviderId[] = [
  "github-copilot",
  "anthropic",
  "openai",
  "openrouter",
  "amazon-bedrock",
  "google-vertex-ai",
];

/**
 * Sort detected providers by OpenCode's precedence. Unknown providers are
 * appended in original order.
 */
export function sortByOpenCodePrecedence(detected: string[]): string[] {
  const known = new Set<string>(OPENCODE_PROVIDER_PRECEDENCE);
  const inOrder: string[] = [];
  for (const p of OPENCODE_PROVIDER_PRECEDENCE) if (detected.includes(p)) inOrder.push(p);
  for (const p of detected) if (!known.has(p)) inOrder.push(p);
  return inOrder;
}

/** Test seam: get the table at runtime so tests can override. */
export function getProviderTable(): typeof PROVIDER_TABLE_V1_0_0_RC_5 {
  return PROVIDER_TABLE_V1_0_0_RC_5;
}
