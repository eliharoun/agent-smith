// src/io/atlassian-auth.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { SmithError } from "../core/smith-error";
import { stateHome } from "./state-home";

// Note: there is no `DEFAULT_ATLASSIAN_BASE_URL`. Atlassian Cloud
// instances are workspace-scoped — every customer gets a subdomain
// like `https://<workspace>.atlassian.net`. The pre-rc.4 default
// `"https://atlassian.net"` was always invalid (no Atlassian instance
// lives at that bare host) and silently routed every Confluence/Jira
// request to a non-existent URL when SMITH_ATLASSIAN_BASE_URL was
// unset. Resolution now walks the same auth-resolution tier order
// (smith env → smith file) and surfaces a clear `usage-error`
// remediation when no tier provides a URL.

export interface AtlassianAuth {
  email: string;
  token: string;
  source: "env-smith" | "file-smith";
}

export interface ResolveOpts {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves Atlassian credentials in priority order:
 *   1. process env SMITH_ATLASSIAN_EMAIL + (SMITH_ATLASSIAN_API_TOKEN || SMITH_JIRA_API_TOKEN)
 *   2. ~/.config/agent-smith/.env (same SMITH_* keys)
 *
 * Returns the first complete (email + token) pair found, or null if none match.
 */
export function resolveAtlassianAuth(opts: ResolveOpts = {}): AtlassianAuth | null {
  const env = opts.env ?? process.env;
  // Tier-2 file (agent-smith .env) must honor $XDG_CONFIG_HOME in production.
  // When `homeDir` is supplied (test seam) the call site is asserting on a
  // HOME-rooted layout, so preserve `<home>/.config/agent-smith` literally.
  const smithEnvDir = opts.homeDir ? join(opts.homeDir, ".config/agent-smith") : stateHome();

  // Tier 1: SMITH env
  const smithEnv = pair(
    env["SMITH_ATLASSIAN_EMAIL"],
    env["SMITH_ATLASSIAN_API_TOKEN"] ?? env["SMITH_JIRA_API_TOKEN"],
  );
  if (smithEnv) return { ...smithEnv, source: "env-smith" };

  // Tier 2: SMITH file
  const smithFile = readDotenv(join(smithEnvDir, ".env"));
  const smithFilePair = pair(
    smithFile["SMITH_ATLASSIAN_EMAIL"],
    smithFile["SMITH_ATLASSIAN_API_TOKEN"] ?? smithFile["SMITH_JIRA_API_TOKEN"],
  );
  if (smithFilePair) return { ...smithFilePair, source: "file-smith" };

  return null;
}

/**
 * Resolves the user's Atlassian Cloud base URL via the same tier order
 * `resolveAtlassianAuth` walks. Returns `null` if no tier provides a
 * URL — callers MUST surface a clear remediation rather than falling
 * back to a placeholder, because there is no valid placeholder for
 * Atlassian Cloud (every workspace is a subdomain).
 *
 * Env-var key: `SMITH_ATLASSIAN_BASE_URL` (tiers 1–2).
 */
export function resolveAtlassianBaseUrl(opts: ResolveOpts = {}): string | null {
  const env = opts.env ?? process.env;
  const smithEnvDir = opts.homeDir ? join(opts.homeDir, ".config/agent-smith") : stateHome();

  const smithEnvUrl = trimOrNull(env["SMITH_ATLASSIAN_BASE_URL"]);
  if (smithEnvUrl) return smithEnvUrl;

  const smithFile = readDotenv(join(smithEnvDir, ".env"));
  const smithFileUrl = trimOrNull(smithFile["SMITH_ATLASSIAN_BASE_URL"]);
  if (smithFileUrl) return smithFileUrl;

  return null;
}

/**
 * Build the "Atlassian workspace URL not configured" remediation message.
 * Hoisted so the Confluence/Jira fetchers can throw a single canonical
 * SmithError shape and the doctor can surface the same hint.
 */
export function remediationBaseUrlMissing(): string {
  return (
    "Atlassian workspace URL not configured. Set SMITH_ATLASSIAN_BASE_URL " +
    "to your workspace URL (e.g. https://acme.atlassian.net) in your process " +
    `env or ${join(stateHome(), ".env")}. Atlassian Cloud instances are ` +
    "workspace-scoped — there is no global default URL. The GUI's Atlassian " +
    "credentials panel can write the .env file for you."
  );
}

/**
 * Canonical step-by-step instructions for creating an Atlassian API
 * token. Mirrors the official Atlassian guidance at
 * https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/
 *
 * Returned as an array of lines so callers can render in the format
 * appropriate for their surface:
 *   - SmithError messages: `.join("\n")` for the body of a single message
 *   - Doctor renderer:     prefix each line with the section's indent
 *   - GUI hint:            consume the canonical bullet without re-stating it
 *
 * Why we tell users to use the unscoped "Create API token" button even
 * though Atlassian recommends scoped tokens for security: scoped tokens
 * are issued for the API gateway endpoints
 *   - https://api.atlassian.com/ex/jira/{cloudId}
 *   - https://api.atlassian.com/ex/confluence/{cloudId}
 * smith's Confluence/Jira fetchers (src/io/confluence.ts, src/io/jira.ts)
 * call the workspace URL directly (e.g. https://acme.atlassian.net/wiki/api/v2/...).
 * A scoped token would not authenticate against that URL. Adding scoped-
 * token support requires resolving the user's `cloudId` and rewriting
 * every API URL — deferred work.
 */
export function tokenCreationInstructions(): string[] {
  return [
    "To create an Atlassian API token:",
    "  1. Visit https://id.atlassian.com/manage-profile/security/api-tokens",
    "     (you may be asked to verify your identity via a one-time email passcode).",
    "  2. Click 'Create API token'. NOTE: Atlassian also offers 'Create API token",
    "     with scopes' (recommended by Atlassian for security), but agent-smith does",
    "     not yet support scoped tokens — they require routing through",
    "     https://api.atlassian.com/ex/{jira,confluence}/{cloudId} while smith calls",
    "     your workspace URL directly. Use the unscoped 'Create API token' button.",
    "  3. Give the token a descriptive name (e.g. 'agent-smith').",
    "  4. Set an expiration date (1-365 days; Atlassian's default is 1 year).",
    "  5. Click 'Create', then 'Copy to clipboard' — the token cannot be recovered",
    "     after this step. Save it in a password manager.",
    "The same token authenticates against Confluence and Jira on the workspace you",
    "authenticated to. Reference:",
    "  https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
  ];
}

export function basicAuthHeader(auth: AtlassianAuth): string {
  const encoded = Buffer.from(`${auth.email}:${auth.token}`).toString("base64");
  return `Basic ${encoded}`;
}

// ---------- internals ----------

function pair(
  email: string | undefined,
  token: string | undefined,
): { email: string; token: string } | null {
  if (!email || !token) return null;
  return { email: email.trim(), token: token.trim() };
}

function trimOrNull(v: string | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDotenv(path: string): Record<string, string> {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    if (code === "EACCES" || code === "EPERM") {
      throw new SmithError({ code: "permission-denied", path, operation: "read" }, { cause: err });
    }
    throw new Error(`failed to read ${path}: ${(err as Error).message}`, { cause: err });
  }
  return parseDotenv(raw);
}
