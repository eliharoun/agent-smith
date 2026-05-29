import { encode } from "gpt-tokenizer";

/**
 * Estimate token count for `text` using cl100k_base. This is an approximation
 * (real model tokenizers vary slightly); used only for inline-budget arithmetic,
 * not for any behavior that requires exact match with the production model.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}
