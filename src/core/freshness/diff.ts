import diff from "microdiff";
import type { DriftSummary } from "./types";

/**
 * Recursively normalize arrays of primitives by sorting them. This makes
 * `["a","b","c"]` and `["c","a","b"]` compare equal, so cosmetic enum
 * reordering in the upstream OpenCode schema doesn't register as drift.
 *
 * Arrays of objects are NOT sorted (no canonical ordering), so structural
 * changes inside object arrays still register. Object keys are sorted so
 * key reordering in JSON files also doesn't register as drift.
 *
 * Primitive arrays are sorted by string coercion; numeric ordering doesn't
 * matter here because we only care about set equality, not magnitude.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(normalize);
    const allPrimitive = normalized.every(
      (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    if (allPrimitive) {
      return [...normalized].sort((a, b) =>
        String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
      );
    }
    return normalized;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = normalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Compute a structural diff between two JSON-derived records. Inputs are
 * normalized first: arrays of primitives are sorted, object keys are sorted,
 * arrays of objects are left in original order. Returns added/removed/changed
 * paths (slash-separated) plus a one-line headline summary.
 */
export function diffSchemas(
  vendored: Record<string, unknown>,
  live: Record<string, unknown>,
): DriftSummary {
  const v = normalize(vendored) as Record<string, unknown>;
  const l = normalize(live) as Record<string, unknown>;
  const changes = diff(v, l);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const c of changes) {
    const path = c.path.join("/");
    if (c.type === "CREATE") added.push(path);
    else if (c.type === "REMOVE") removed.push(path);
    else if (c.type === "CHANGE") changed.push(path);
    // Defensive: a future microdiff version could add a 4th change type. Drift
    // under-reporting is the worse failure mode for a freshness checker, so
    // bucket unknown types into `changed` rather than silently dropping them.
    else changed.push(path);
  }

  let headline: string;
  const total = added.length + removed.length + changed.length;
  if (total === 0) {
    headline = "no drift";
  } else {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (removed.length > 0) parts.push(`${removed.length} removed`);
    if (changed.length > 0) parts.push(`${changed.length} changed`);
    headline = parts.join(", ");
  }

  return { added, removed, changed, headline };
}
