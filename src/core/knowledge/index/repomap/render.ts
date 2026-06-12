import { encode } from "gpt-tokenizer";
import type { RankedFile } from "./graph";

export function renderMap(ranked: RankedFile[], mapTokens: number): string {
  // Files with no definitions (pure referencers) would render as a bare header
  // line with no body — token cost, zero signal. Drop them from the map.
  const withDefs = ranked.filter((f) => f.defs.length > 0);
  if (withDefs.length === 0) return "(no code sources indexed — knowledge.map is empty)";
  let lo = 1;
  let hi = withDefs.length;
  // Always returns at least the top-ranked file, even if it alone exceeds
  // mapTokens (better a slightly-over map than an empty one).
  let best = render(withDefs.slice(0, 1));
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const text = render(withDefs.slice(0, mid));
    if (encode(text).length <= mapTokens) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function render(files: RankedFile[]): string {
  const out: string[] = [];
  for (const f of files) {
    out.push(`${f.relPath}:`);
    for (const d of f.defs.slice(0, 20)) out.push(`  ${d.signature || d.name}`);
  }
  return out.join("\n");
}
