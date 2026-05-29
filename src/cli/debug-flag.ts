/**
 * Single source of truth for the `SMITH_DEBUG` flag.
 *
 * Truthiness contract:
 *   - `"1"`, `"true"`, `"yes"` (case-insensitive) → enabled.
 *   - Anything else, including unset / empty / `"0"` / `"false"`, → disabled.
 *
 * Deprecation policy:
 *   `AGENT_SMITH_DEBUG` is accepted as a backwards-compat alias to avoid
 *   breaking operators who already script against it. When it is the *active*
 *   source — i.e. `SMITH_DEBUG` is unset or off and `AGENT_SMITH_DEBUG` is
 *   truthy — the first call emits a one-shot stderr warning recommending the
 *   rename. Subsequent calls within the same process do not re-warn, so we
 *   don't spam command output. When `SMITH_DEBUG` is the active source, no
 *   warning fires regardless of `AGENT_SMITH_DEBUG`'s value.
 *
 * All `process.env.SMITH_DEBUG` and `process.env.AGENT_SMITH_DEBUG` reads in
 * `src/` go through `isDebug()`. Direct env reads belong here only.
 */

const TRUTHY = new Set(["1", "true", "yes"]);

function parseFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return TRUTHY.has(raw.toLowerCase());
}

let warned = false;

export function isDebug(): boolean {
  if (parseFlag(process.env.SMITH_DEBUG)) return true;
  if (parseFlag(process.env.AGENT_SMITH_DEBUG)) {
    if (!warned) {
      warned = true;
      process.stderr.write(
        "agent-smith: AGENT_SMITH_DEBUG is deprecated; use SMITH_DEBUG instead.\n",
      );
    }
    return true;
  }
  return false;
}

/**
 * Test-only: reset the one-shot deprecation-warning latch so the warning can
 * be re-asserted in a fresh test. The underscore prefix marks this as not
 * part of the production API.
 */
export function _resetWarnedForTesting(): void {
  warned = false;
}
