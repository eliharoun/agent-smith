// src/core/model-resolution/version-sort.ts

/**
 * Tokenize the trailing version of a model id. Examples:
 *   "github-copilot/claude-opus-4.7"          -> [4, 7]
 *   "anthropic/claude-opus-4-5"               -> [4, 5]
 *   "github-copilot/claude-opus-4.7-thinking" -> [4, 7, "thinking"]
 *   "anthropic/claude-opus-preview"           -> ["preview"]
 *
 * Strategy: strip provider/family prefix up to the first family token
 * (`opus`, `sonnet`, `haiku`), then split the remaining suffix on `.` and
 * `-`. Each fragment becomes a number if numeric, otherwise a string token.
 */
function tokenizeVersion(id: string): Array<number | string> {
  const familyMatch = id.match(/(opus|sonnet|haiku)[-.]?(.*)$/i);
  const suffix = familyMatch?.[2] ?? id;
  if (suffix.length === 0) return [];
  return suffix
    .split(/[.\-]/)
    .filter((t) => t.length > 0)
    .map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

/**
 * Compare two tokenized versions. Returns negative if a<b, positive if a>b,
 * zero if equal.
 *
 * Rules (from spec §pickHighestVersion):
 *   - Numeric vs numeric: numeric comparison.
 *   - Numeric vs missing: numeric wins (so 4.7 > 4).
 *   - String tokens compared lexicographically AFTER numerics.
 *   - Longer overall token lists are NEWER (a thinking variant > bare).
 *   - Numbers sort GREATER than strings at the same position (so a numeric
 *     version like 4.7 outranks a non-numeric token like "preview", which
 *     is what "non-numeric sorts last" means in spec terms).
 */
function compareVersions(a: Array<number | string>, b: Array<number | string>): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return -1; // a is shorter → older → smaller
    if (bi === undefined) return 1;
    const aIsNum = typeof ai === "number";
    const bIsNum = typeof bi === "number";
    if (aIsNum && bIsNum) {
      if (ai !== bi) return (ai as number) - (bi as number);
      continue;
    }
    if (aIsNum && !bIsNum) return 1;  // number > string at same position
    if (!aIsNum && bIsNum) return -1;
    // both strings
    const cmp = (ai as string).localeCompare(bi as string);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function pickHighestVersion(matches: string[]): string {
  if (matches.length === 0) {
    throw new Error("pickHighestVersion: at least one match required");
  }
  // Sort descending; return first.
  const sorted = [...matches].sort((x, y) =>
    compareVersions(tokenizeVersion(y), tokenizeVersion(x)),
  );
  // sorted[0] is non-undefined: we just guarded matches.length === 0.
  return sorted[0] as string;
}
