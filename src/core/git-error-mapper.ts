// src/core/git-error-mapper.ts
//
// Maps a failed git subprocess (operation + stderr) to a friendly SmithError
// payload instead of a raw Error. Without this, git failures from the
// install/discover/sync pipeline (bad URL, unreachable host, missing branch,
// auth prompt) bubble up as plain Errors and the CLI wrapper renders the
// generic "This is a bug in agent-smith" message — see src/cli/wrap.ts.
//
// Classification is best-effort on stderr text:
//   - network / DNS / connection / auth      → network-error
//   - missing repo / ref not found / 404     → not-found
//   - everything else (bad state, etc.)      → validation-failed
//
// `network-error` requires a pre-redacted URL (the renderer trusts it as
// safe), so callers pass the URL through redactSecrets here.

import { redactSecrets } from "./redact";
import type { SmithErrorPayload } from "./smith-error";

const NETWORK_PATTERNS = [
  /could not resolve host/i,
  /couldn't resolve host/i,
  /name or service not known/i,
  /no address associated/i,
  /connection (refused|timed out|reset)/i,
  /failed to connect/i,
  /unable to access/i,
  /operation timed out/i,
  /network is unreachable/i,
  /ssl certificate problem/i,
  /authentication failed/i,
  /could not read username/i,
  /terminal prompts disabled/i,
  /permission denied \(publickey\)/i,
];

const NOT_FOUND_PATTERNS = [
  /repository not found/i,
  /not found/i,
  /does not (appear to be a git repository|exist)/i,
  /remote branch .* not found/i,
  /couldn't find remote ref/i,
  /pathspec .* did not match/i,
  /fatal: .* not a valid (object name|ref)/i,
  /invalid reference/i,
  /unknown revision/i,
];

/**
 * Build a SmithError payload from a failed git operation.
 *
 * @param operation human verb phrase, e.g. "clone repository", "fetch updates"
 * @param url the remote URL involved (redacted before use)
 * @param stderr the git command's stderr (used for classification + snippet)
 */
export function gitOperationError(
  operation: string,
  url: string,
  stderr: string,
): SmithErrorPayload {
  const safeUrl = redactSecrets(url);
  const text = stderr.trim();
  const cause = text.length > 0 ? redactSecrets(text) : "git exited non-zero with no stderr";

  if (NETWORK_PATTERNS.some((re) => re.test(text))) {
    return { code: "network-error", operation: `git ${operation}`, url: safeUrl, cause };
  }
  if (NOT_FOUND_PATTERNS.some((re) => re.test(text))) {
    return {
      code: "not-found",
      what: "git repository or ref",
      identifier: safeUrl,
      suggestedCommand:
        "Check the URL is a cloneable repo (https://github.com/owner/repo) and the branch/tag exists.",
    };
  }
  // Fallback: a real failure we couldn't classify. validation-failed renders
  // the stderr so the user sees what git actually said, without the scary
  // "this is a bug in smith" framing.
  return {
    code: "validation-failed",
    what: `git ${operation}`,
    reasons: [cause],
  };
}
