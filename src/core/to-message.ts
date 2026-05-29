/**
 * Safe extraction of a human-readable message from a caught value.
 *
 * Catch handlers receive `unknown` — nothing in the language prevents
 * a callee from `throw "literal"`, `throw undefined`, `throw { ... }`,
 * etc. The widely-used `(err as Error).message` cast silently produces
 * the literal string `"undefined"` for non-Error throws, which then
 * leaks into user-facing diagnostics. See `docs/2026-05-04-error-audit-
 * consolidated.md` Theme G for the audit of leak sites.
 *
 * Contract:
 *   - Error / Error subclass  -> `err.message`
 *   - string                  -> the string itself
 *   - anything else           -> `String(value)`
 *   - if `String(value)` itself throws (e.g. a `toString` that throws,
 *     or a `message` getter that throws on Error-like impostors), the
 *     helper returns a sentinel and never propagates.
 *
 * The helper deliberately does NOT JSON.stringify objects: thrown
 * values can carry cycles, and the caller's intent here is "give me
 * something I can render", not "give me a structured dump". Callers
 * who need structured output should narrow themselves.
 */
export function toMessage(value: unknown): string {
  if (value instanceof Error) {
    try {
      const m = value.message;
      // `message` is typed `string` but a subclass with a getter could
      // return anything; defend.
      return typeof m === "string" ? m : String(m);
    } catch {
      return "<error reading Error.message>";
    }
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return String(value);
  } catch {
    return "<unstringifiable value>";
  }
}
