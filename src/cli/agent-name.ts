/**
 * CLI-boundary agent-name validation. Defense-in-depth helper.
 *
 * Why this exists separately from the schema's KEBAB regex in
 * src/core/config-schema.ts — that one validates bundle-internal config
 * during parseConfig() AFTER the bundle has been resolved on disk. CLI
 * verbs that take an agent name as an argument and then build filesystem
 * paths from it (rm, mkdir, writeFile, join) need to reject traversal
 * sequences BEFORE any IO happens. We keep this helper standalone so it:
 *   - has zero dependencies on the schema layer beyond the shared regex,
 *   - throws SmithError directly with structured reasons,
 *   - can be unit-tested in isolation.
 *
 * Most CLI commands already route through findBundleOrFail() which loads
 * the registry and implicitly validates names upstream. Only entry points
 * that touch the filesystem BEFORE that lookup need this helper:
 *   - src/cli/commands/knowledge/fetch.ts   (rm of cache dir)
 *   - src/cli/commands/agent/reconfigure.ts (join with paths.codex etc.)
 *   - src/cli/commands/init-agent.ts        (mkdir of new bundle; also
 *                                            --from source path join)
 *
 * `KEBAB_AGENT_NAME` is a re-export of `KEBAB` from `config-schema.ts`
 * (same RegExp object). A contract test enforces no drift.
 */
import { KEBAB } from "../core/kebab";
import { SmithError } from "../core/smith-error";

export const KEBAB_AGENT_NAME = KEBAB;

export function assertValidAgentName(name: string, what = "agent name"): void {
  // Single-reason-per-call by design. We report the most-specific
  // security-relevant defect first (NUL > path-separator > hidden-dot >
  // shape) so the user fixes one thing at a time and the error message
  // points at the actual security boundary that was violated, not a
  // downstream symptom. Each branch returns via the throw at the end.
  let reason: string | undefined;
  if (name === "") {
    reason = "must not be empty";
  } else if (name.includes("\0")) {
    reason = 'must not contain NUL byte ("\\0")';
  } else if (name.includes("/")) {
    reason = 'must not contain "/"';
  } else if (name.includes("\\")) {
    reason = 'must not contain "\\"';
  } else if (name.startsWith(".")) {
    reason = 'must not start with "."';
  } else if (!KEBAB_AGENT_NAME.test(name)) {
    reason =
      "must be kebab-case (lowercase letters, digits, hyphens; must start with a letter)";
  }
  if (reason === undefined) return;
  throw new SmithError({
    code: "validation-failed",
    what: `${what} "${name}"`,
    reasons: [reason],
  });
}
