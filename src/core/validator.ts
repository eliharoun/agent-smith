import { validateKnowledge } from "./knowledge/validator";
import { type FileSlot, getEffectiveThresholds } from "./thresholds";
import type { CanonicalConfig } from "./types";

export const FAIL_CHARS = 64_000;

// CORE-14: deliberately coarse char-based bound used ONLY for prose-mode
// length validation in `validateAssembledTotal` below. This is NOT a
// precise token count — the real cl100k token count from
// `src/core/knowledge/tokens.ts` is what drives the inline-budget
// arithmetic in `src/core/knowledge/pipeline.ts`. The two methods can
// disagree at the boundary by ~10-15%; that is acceptable because the
// char-based check here is a pre-acquire guard against runaway prose,
// while the token-accurate accounting in the pipeline runs post-acquire
// against the real model budget. Tightening this constant would not
// improve correctness — it would only force authors to game a bound
// that doesn't reflect what the model actually sees.
const CHARS_PER_TOKEN = 4;

export interface ValidatorInput {
  config: CanonicalConfig;
  files: { identity: string; expertise: string; soul: string; user: string };
  assembledBody: string;
}

export type ValidatorResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function lineCount(s: string): number {
  return s.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

export function validate(input: ValidatorInput): ValidatorResult {
  const thresholds = getEffectiveThresholds(input.config);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Empty file check
  for (const [name, content] of Object.entries(input.files)) {
    if (content.trim().length < 5) {
      errors.push(`File ${name} is empty or near-empty (< 5 non-whitespace chars)`);
    }
  }

  // TODO marker check on persona files (IDENTITY/EXPERTISE/SOUL).
  // A freshly-scaffolded bundle contains TODO stubs; the-architect skill relies
  // on `smith agent validate` failing until a human replaces the stubs.
  const PERSONA_FILE_NAMES: Record<string, string> = {
    identity: "IDENTITY.md",
    expertise: "EXPERTISE.md",
    soul: "SOUL.md",
  };
  for (const [name, displayName] of Object.entries(PERSONA_FILE_NAMES)) {
    const content = input.files[name as keyof typeof input.files];
    if (content && /<!--\s*TODO/i.test(content)) {
      errors.push(
        `File ${displayName} contains a TODO marker — replace stub content before installing`,
      );
    }
  }

  // Length budget on assembled body
  if (input.assembledBody.length > FAIL_CHARS) {
    errors.push(
      `Assembled body length ${input.assembledBody.length} exceeds hard limit ${FAIL_CHARS}`,
    );
  } else if (input.assembledBody.length > thresholds.warnChars) {
    warnings.push(
      `Assembled body length ${input.assembledBody.length} exceeds soft limit ${thresholds.warnChars}`,
    );
  }

  // Per-file line range
  for (const [name, [min, max]] of Object.entries(thresholds.lineRanges) as [
    FileSlot,
    [number, number],
  ][]) {
    const content = input.files[name];
    if (!content) continue;
    const n = lineCount(content);
    if (n < min || n > max) {
      warnings.push(`File ${name} has ${n} non-blank lines; recommended range is ${min}-${max}`);
    }
  }

  // 2nd-person voice on prompt files (not USER.md — that's user context)
  for (const name of ["identity", "expertise", "soul"] as const) {
    const content = input.files[name];
    if (!/\bYou\b/.test(content)) {
      warnings.push(
        `File ${name} does not contain 'You' — agent prompts should be written in 2nd person`,
      );
    }
    if (/\bI am\b/i.test(content) || /\bAs an AI\b/i.test(content)) {
      warnings.push(
        `File ${name} contains 'I am' or 'As an AI' — these phrases trigger model roleplay/disclaimer modes`,
      );
    }
  }

  // v0.6.0: model field info-notes (opencode-specific override).
  if (input.config.model !== undefined) {
    if (!input.config.targets.includes("opencode")) {
      warnings.push(
        `info: 'model' field has no effect because targets do not include opencode.`,
      );
    } else if (input.config.targets.includes("claude-code")) {
      warnings.push(
        `info: 'model' override set; 'modelTier' will be used for claude-code only.`,
      );
    }
  }

  // Knowledge block validation: rejects unsupported source types/materializers
  // (npm, pdf-extract), duplicate ids, oversized inline budgets, etc.
  const k = validateKnowledge(input.config.knowledge, {
    declaredMcpServers: [
      ...(input.config.mcp?.required ?? []),
      ...(input.config.mcp?.peer ?? []),
      ...(input.config.mcpServers ?? []),
    ],
  });
  errors.push(...k.errors);
  warnings.push(...k.warnings);

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, warnings };
}

/**
 * Knowledge-aware total-body length check. Runs on the FINAL rendered body
 * (prose + assembled knowledge sections). The prose-only `validate()` above
 * still gates author intent against the effective `warnChars` (per-bundle
 * override or `DEFAULT_THRESHOLDS.warnChars` when absent); this second
 * check allows the body to grow by `inlineBudgetTokens * CHARS_PER_TOKEN`
 * to accommodate legitimate inline knowledge without silently shipping
 * oversized renders.
 *
 * The bundle's effective `warnChars` (computed via `getEffectiveThresholds`,
 * same merge semantics as `validate()`) is used as the prose-budget
 * baseline before adding the knowledge allowance. `FAIL_CHARS` remains the
 * non-overridable hard error gate in both this path and `validate()`.
 */
export type AssembledValidatorResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export function validateAssembledTotal(
  body: string,
  inlineBudgetTokens: number,
  config: CanonicalConfig,
): AssembledValidatorResult {
  const thresholds = getEffectiveThresholds(config);
  const warnings: string[] = [];
  const extra = inlineBudgetTokens * CHARS_PER_TOKEN;
  const baseWarn = thresholds.warnChars;
  const fail = FAIL_CHARS + extra;
  const warn = baseWarn + extra;
  const len = body.length;
  if (len > fail) {
    return {
      ok: false,
      errors: [
        `Assembled body (with knowledge) length ${len} exceeds hard limit ${fail} (prose budget ${FAIL_CHARS} + knowledge allowance ${extra})`,
      ],
      warnings,
    };
  }
  if (len > warn) {
    warnings.push(
      `Assembled body (with knowledge) length ${len} exceeds soft limit ${warn} (prose budget ${baseWarn} + knowledge allowance ${extra})`,
    );
  }
  return { ok: true, warnings };
}
