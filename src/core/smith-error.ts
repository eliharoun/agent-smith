/**
 * Classified errors thrown by smith. Carries a discriminated payload so the
 * CLI wrapper can render structured messages with concrete recovery steps
 * instead of raw stack traces. See:
 *   docs/superpowers/specs/2026-05-04-smith-error-and-cli-wrapper-design.md
 */
export type SmithErrorPayload =
  // Catalog file problems — recovery is multi-step, no single command.
  | { code: "registry-version"; current: number; expected: number; path: string }
  | { code: "registry-corrupt-json"; path: string; parseError: string }
  | { code: "skill-registry-version"; current: number; expected: number; path: string }
  // Catalog file shape problem — JSON parsed but per-source schema invalid.
  // `reasons` lists every problem so the user can fix them in one edit.
  | {
      code: "registry-corrupt-shape";
      path: string;
      reasons: string[];
    }
  // State file — single-command recovery.
  | { code: "installed-skills-corrupt"; path: string; parseError: string }
  // Config missing — caller knows the right init command.
  | { code: "config-missing"; path: string; suggestedCommand: string }
  // System-level — no automatable fix.
  // operation: free-form verb phrase ("read", "write", "search issues",
  // etc.). httpErrorFor passes the caller's opts.operation through; fs
  // callers stick to the canonical "read"/"write".
  | { code: "permission-denied"; path: string; operation: string }
  // User input — sometimes recoverable.
  | { code: "usage-error"; message: string; suggestedCommand?: string }
  // Validation — caller composes the bypass-flagged retry.
  | {
      code: "validation-failed";
      /** Short noun phrase, e.g. "agent catalog", "skill bundle". */
      what: string;
      reasons: string[];
      suggestedCommand?: string;
    }
  // Partial — show details, not a command. `details` is human-readable;
  // prefer including each item's identifier so the user can re-run scoped.
  | {
      code: "partial-failure";
      operation: string;
      succeeded: number;
      failed: number;
      skipped: number;
      details: string[];
    }
  // State-precondition failures — the named entity does/doesn't exist.
  | {
      code: "not-found";
      what: string;
      identifier: string;
      suggestedCommand?: string;
    }
  | {
      code: "already-exists";
      what: string;
      identifier: string;
      suggestedCommand?: string;
    }
  // Skill-catalog state-precondition failure — refuses to remove protected
  // catalogs. Headline conveys the issue; no Try line because there is no
  // recovery — the catalog is intentionally protected.
  | { code: "protected-catalog"; name: string }
  // Agent/skill bundle is part of the smith product surface — refuse mutation.
  // `message` is the full pre-formatted refusal (from refusalMessage() in
  // src/core/protected-bundles.ts) and is rendered verbatim as the headline.
  | { code: "protected-bundle"; message: string }
  // Clone-mode confirmation declined by the user. Rendered as a plain
  // cancellation, not a red error.
  | { code: "user-aborted"; what: string }
  // Skill registry JSON parse failure — mirrors registry-corrupt-json on
  // the agent-registry side.
  | {
      code: "skill-registry-corrupt-json";
      path: string;
      parseError: string;
    }
  // Skill registry shape problem — JSON parsed but per-catalog schema invalid.
  // Mirrors registry-corrupt-shape on the agent-registry side. `reasons`
  // accumulates every problem so the user can fix them all in one edit.
  | {
      code: "skill-registry-corrupt-shape";
      path: string;
      reasons: string[];
    }
  // HTTP request failure surfaced from io-layer callers (atlassian/confluence/
  // jira/fetch). 401/403 callers should NOT use this — they map to
  // permission-denied via httpErrorFor. Generic 4xx/5xx use this.
  | {
      code: "http-error";
      service: string;
      status: number;
      url: string;
      operation?: string;
      snippet?: string;
    }
  // Network-layer failure (DNS, ECONNREFUSED, fetch TypeError, etc.) where
  // no HTTP response was received. Distinct from `http-error`, which
  // represents a server-returned non-2xx. Caller MUST pre-redact the URL
  // via redactSecrets before constructing this — the renderer trusts
  // payload.url as already-safe.
  | {
      code: "network-error";
      operation: string;
      url: string;
      cause: string;
    }
  // Internal smith bug: a code path was reached that requires a DI
  // dependency the caller forgot to inject. NEVER emitted to end-users
  // as a normal failure mode — always indicates a missing wire-up that
  // should be fixed in smith itself.
  | {
      code: "internal-error";
      message: string;
    }
  // Model resolution — layered resolver exhausted all providers for a tier.
  | {
      code: "model-resolution-failed";
      agent: string;
      tier: "high" | "balanced" | "fast";
      preferences: string[];
      authenticated: string[];
      hint: string;
    };

export type SmithErrorCode = SmithErrorPayload["code"];

export class SmithError extends Error {
  readonly payload: SmithErrorPayload;
  constructor(payload: SmithErrorPayload, opts?: { cause?: unknown }) {
    super(formatHeadline(payload), opts);
    this.name = "SmithError";
    this.payload = payload;
  }
  get code(): SmithErrorCode {
    return this.payload.code;
  }
}

export function formatHeadline(payload: SmithErrorPayload): string {
  switch (payload.code) {
    case "registry-version":
      return "agent catalog file version mismatch";
    case "registry-corrupt-json":
      return "agent catalog file is corrupt";
    case "registry-corrupt-shape":
      return "agent catalog file has invalid shape";
    case "skill-registry-version":
      return "skill catalog file version mismatch";
    case "installed-skills-corrupt":
      return "installed-skills state file is corrupt";
    case "config-missing":
      return "config file missing";
    case "permission-denied":
      return "permission denied";
    case "usage-error":
      return payload.message;
    case "validation-failed":
      return `${payload.what} validation failed`;
    case "partial-failure":
      return `${payload.operation} completed with errors`;
    case "not-found":
      return `${payload.what} not found: ${payload.identifier}`;
    case "already-exists":
      return `${payload.what} already exists: ${payload.identifier}`;
    case "protected-catalog":
      return `cannot unregister protected catalog '${payload.name}'`;
    case "protected-bundle":
      return payload.message;
    case "user-aborted":
      return `${payload.what} cancelled by user.`;
    case "skill-registry-corrupt-json":
      return "skill catalog file is corrupt";
    case "skill-registry-corrupt-shape":
      return "skill catalog file has invalid shape";
    case "http-error": {
      const op = payload.operation ? ` ${payload.operation}` : "";
      return `${payload.service}${op}: HTTP ${payload.status}`;
    }
    case "network-error":
      return `${payload.operation} failed: network error`;
    case "internal-error":
      return "smith internal error";
    case "model-resolution-failed":
      return `model resolution failed for tier '${payload.tier}'`;
  }
}

/**
 * Multi-line remediation block. Returns "" when the body already covers
 * everything (e.g. partial-failure renders details inline) or when the
 * caller supplied no actionable hint (usage-error / validation-failed
 * without suggestedCommand). The CLI renderer in src/cli/wrap.ts is
 * responsible for skipping the leading blank line when this is empty.
 */
export function formatRemediation(payload: SmithErrorPayload): string {
  switch (payload.code) {
    case "registry-version":
      return [
        "This file was written by a different version of agent-smith. To recover:",
        `  1. Move the file aside:  mv ${payload.path} ${payload.path}.bak`,
        "  2. Re-initialize:        smith init",
        "  3. Re-register external catalogs:  smith agent register <path> --kind registered --label <label>",
      ].join("\n");
    case "registry-corrupt-json":
      return [
        `The file at ${payload.path} is not valid JSON.`,
        "Either:",
        "  - Fix the JSON syntax manually (edit the file), or",
        `  - Move it aside:  mv ${payload.path} ${payload.path}.bak`,
        "    then re-run:    smith init",
      ].join("\n");
    case "registry-corrupt-shape":
      return [
        `The file at ${payload.path} parsed as JSON but its contents do not match the registry schema.`,
        "Either:",
        "  - Fix the listed problems by editing the file, or",
        `  - Move it aside:  mv ${payload.path} ${payload.path}.bak`,
        "    then re-run:    smith init",
      ].join("\n");
    case "skill-registry-version":
      return [
        "This file was written by a different version of agent-smith. To recover:",
        `  1. Move the file aside:  mv ${payload.path} ${payload.path}.bak`,
        "  2. Re-initialize:        smith init",
        "  3. Re-register skill catalogs:  smith skill register <path> --kind <kind> --label <label>",
      ].join("\n");
    case "installed-skills-corrupt":
      return [
        `Remove the corrupt state file and re-install your skills:`,
        `  rm ${payload.path}`,
        `  smith skill install <ref>   # repeat per skill you had installed`,
      ].join("\n");
    case "config-missing":
      return `Run \`${payload.suggestedCommand}\` to initialize.`;
    case "permission-denied":
      return `Check ownership and permissions on ${payload.path}. Current user needs ${payload.operation} access.`;
    case "usage-error":
      return payload.suggestedCommand ? `Try: ${payload.suggestedCommand}` : "";
    case "validation-failed":
      return payload.suggestedCommand ? `Try: ${payload.suggestedCommand}` : "";
    case "partial-failure":
      return "";
    case "not-found":
    case "already-exists":
      return payload.suggestedCommand ? `Try: ${payload.suggestedCommand}` : "";
    case "protected-catalog":
      // Intentionally no remediation — protected catalogs are protected
      // exactly because there's no user-facing recovery path.
      return "";
    case "protected-bundle":
      // The headline already carries the full refusal + the legitimate path.
      return "";
    case "user-aborted":
      // Plain cancellation — nothing to remediate.
      return "";
    case "skill-registry-corrupt-json":
      return [
        `The file at ${payload.path} is not valid JSON.`,
        "Either:",
        "  - Fix the JSON syntax manually (edit the file), or",
        `  - Move it aside:  mv ${payload.path} ${payload.path}.bak`,
        "    then re-register skill catalogs:  smith skill register <path> --kind <kind> --label <label>",
      ].join("\n");
    case "skill-registry-corrupt-shape":
      return [
        `The file at ${payload.path} parsed as JSON but its contents do not match the skill registry schema.`,
        "Either:",
        "  - Fix the listed problems by editing the file, or",
        `  - Move it aside:  mv ${payload.path} ${payload.path}.bak`,
        "    then re-register skill catalogs:  smith skill register <path> --kind <kind> --label <label>",
      ].join("\n");
    case "http-error":
      return payload.status >= 500
        ? "The server returned an error. Verify the service is reachable and retry."
        : "Verify the request is well-formed and the resource exists.";
    case "network-error":
      return [
        "Check connectivity, DNS resolution, or proxy settings.",
        "The URL has been redacted; original credentials/tokens are not shown.",
      ].join("\n");
    case "internal-error":
      return `${payload.message}\nThis is a bug in smith itself — please report it.`;
    case "model-resolution-failed":
      return payload.hint;
  }
}
