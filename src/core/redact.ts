/**
 * Strip secret-bearing substrings from arbitrary text.
 *
 * Total function: never throws, never URL-parses. Two regexes:
 *
 *   1. `scheme://[userinfo@]rest` — drop the `userinfo@` part. Inherits
 *      the semantics of the old `redactUrl` from `acquire.ts`. SCP-style
 *      shorthand (`git@host:path`) carries no scheme and is left alone.
 *
 *   2. `[?&]<secret-key>=<value>` (case-insensitive) — replace value with
 *      `[redacted]`. Covers signed URLs, OAuth callbacks, query-token
 *      APIs (S3 presigned, GitHub callbacks, etc.). The value-boundary
 *      regex stops at `&`, `#`, or whitespace — preserves the
 *      `&next=key` separator so following params still render correctly.
 *
 * Idempotent: redacting an already-redacted string is a no-op.
 *
 * Out of scope (tracked in the Batch 16 spec § "Out of scope"):
 * subprocess stderr passthrough, Authorization-header values inside
 * error-response snippets, path-component secret detection.
 */

const USERINFO = /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/g;

const SECRET_KEYS = [
  "api_key",
  "apikey",
  "token",
  "access_token",
  "auth",
  "authorization",
  "signature",
  "sig",
  "x-amz-signature",
  "key",
  "secret",
  "password",
];

const QUERY_VALUE = new RegExp(
  `([?&](?:${SECRET_KEYS.join("|")})=)[^&\\s#]+`,
  "gi",
);

export function redactSecrets(input: string): string {
  return input.replace(USERINFO, "$1").replace(QUERY_VALUE, "$1[redacted]");
}
