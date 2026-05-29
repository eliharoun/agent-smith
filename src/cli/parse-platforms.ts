import { SmithError } from "../core/smith-error";
import { PLATFORM_IDS, type PlatformId } from "../io/platform-detect";

/**
 * Parse a `--platforms <csv>` value into a deduped list of valid `PlatformId`s.
 * Returns `undefined` when the option was not provided.
 *
 * Throws a `usage-error` SmithError on:
 *   - empty string
 *   - empty entry (e.g. "a,,b" or trailing comma)
 *   - unknown platform id
 *
 * Whitespace around entries is trimmed. Order is preserved (first occurrence
 * wins) so `--platforms opencode,codex` produces a stable target order for
 * deterministic output and lock-key generation.
 */
export function parsePlatforms(value: string | undefined): PlatformId[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") {
    throw new SmithError({
      code: "usage-error",
      message: "--platforms requires a comma-separated list (e.g. --platforms opencode,codex)",
    });
  }
  const parts = value.split(",").map((p) => p.trim());
  const out: PlatformId[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part === "") {
      throw new SmithError({
        code: "usage-error",
        message: `--platforms has an empty entry in '${value}'`,
      });
    }
    if (!PLATFORM_IDS.includes(part as PlatformId)) {
      throw new SmithError({
        code: "usage-error",
        message: `--platforms unknown platform '${part}' (valid: ${PLATFORM_IDS.join(", ")})`,
      });
    }
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part as PlatformId);
  }
  return out;
}
