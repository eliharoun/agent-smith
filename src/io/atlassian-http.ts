import { join } from "node:path";
import { redactSecrets } from "../core/redact";
import { SmithError } from "../core/smith-error";
import { tokenCreationInstructions } from "./atlassian-auth";
import { httpErrorFor } from "./http-error";
import { stateHome } from "./state-home";

/**
 * Build the "Atlassian credentials not configured" remediation message.
 * Evaluated at call time so it reflects the current `XDG_CONFIG_HOME`
 * (was previously a module-level const that hard-coded `~/.config/agent-smith`).
 *
 * Token-creation steps come from the canonical
 * `tokenCreationInstructions()` helper in `./atlassian-auth.ts` so all
 * surfaces (this remediation, doctor's atlassian-auth section, the
 * `auth: atlassian` URL flow in `core/knowledge/acquire.ts`) stay in
 * sync with Atlassian's official guidance.
 */
export function remediationNotConfigured(): string {
  const head =
    `Atlassian credentials not configured. Create ${join(stateHome(), ".env")} with ` +
    "SMITH_ATLASSIAN_EMAIL and SMITH_ATLASSIAN_API_TOKEN.";
  return [head, "", ...tokenCreationInstructions()].join("\n");
}

export interface RequestBudget {
  /** Increment before each fetch; throws if it would exceed the cap. */
  consume(): void;
}

const DEFAULT_REQUEST_BUDGET = 200;

export function createRequestBudget(max: number = DEFAULT_REQUEST_BUDGET): RequestBudget {
  let used = 0;
  return {
    consume() {
      used += 1;
      if (used > max) {
        throw new SmithError({
          code: "validation-failed",
          what: "Atlassian request budget",
          reasons: [`Atlassian: exceeded ${max}-request budget for one call`],
          suggestedCommand: "Narrow scope or raise maxPages/maxResults",
        });
      }
    },
  };
}

/** Reads the response body for an error message, never including request data. */
export async function errorBodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return "";
    return ` (${trimmed.slice(0, 200)})`;
  } catch {
    return "";
  }
}

const PER_REQUEST_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 90_000;
const MAX_ATTEMPTS = 4;
const BACKOFF_5XX_BASE_MS = [500, 1000, 2000] as const;
const RETRY_AFTER_CAP_MS = 30_000;
const RETRY_AFTER_DEFAULT_MS = 1000;
const RETRYABLE_5XX = new Set([502, 503, 504]);

export interface AtlassianFetchOpts {
  /** Caller AbortSignal; composed with the internal 30s timeout signal. */
  signal?: AbortSignal;
  /** Test override: returns a Promise that resolves after `ms`. */
  sleep?: (ms: number) => Promise<void>;
  /** Test override: jitter source, returns [0, 1). */
  random?: () => number;
  /** Test override: monotonic clock in ms; defaults to Date.now. */
  now?: () => number;
  /** Per-call request budget; consumed once per fetch attempt (incl. retries). */
  budget?: RequestBudget;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Compose two AbortSignals. The returned signal aborts when EITHER input
 * aborts. Caller must invoke the returned `cleanup` to drop listeners.
 */
function composeSignals(
  a: AbortSignal | undefined,
  b: AbortSignal,
): {
  signal: AbortSignal;
  cleanup: () => void;
  whichAborted: () => "caller" | "internal" | null;
} {
  if (!a) {
    return {
      signal: b,
      cleanup: () => {},
      whichAborted: () => (b.aborted ? "internal" : null),
    };
  }
  const controller = new AbortController();
  const onA = () => controller.abort(a.reason);
  const onB = () => controller.abort(b.reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener("abort", onA, { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener("abort", onB, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      a.removeEventListener("abort", onA);
      b.removeEventListener("abort", onB);
    },
    whichAborted: () => {
      if (a.aborted) return "caller";
      if (b.aborted) return "internal";
      return null;
    },
  };
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function jitter(baseMs: number, random: () => number): number {
  // Full jitter: result is in [0.5*base, 1.5*base).
  return Math.floor(baseMs * (0.5 + random()));
}

function parseRetryAfter(raw: string | null): number {
  if (!raw) return RETRY_AFTER_DEFAULT_MS;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return RETRY_AFTER_DEFAULT_MS;
  return seconds * 1000;
}

export async function atlassianFetch(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch,
  opts: AtlassianFetchOpts = {},
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const start = now();

  let lastSnippet = "";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    opts.budget?.consume();
    if (now() - start > TOTAL_BUDGET_MS) {
      throw new SmithError({
        code: "validation-failed",
        what: "Atlassian request",
        reasons: [`Request to ${url} exceeded 90s total budget`],
      });
    }

    const timeoutSignal = AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS);
    const composed = composeSignals(opts.signal, timeoutSignal);

    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: composed.signal });
    } catch (err) {
      composed.cleanup();
      if (isAbortError(err)) {
        const which = composed.whichAborted();
        if (which === "caller") {
          throw err;
        }
        // Either internal timeout or unknown — treat as timeout.
        throw new SmithError({
          code: "validation-failed",
          what: "Atlassian request",
          reasons: [`Request to ${url} timed out after 30s`],
        });
      }
      throw err;
    }
    composed.cleanup();

    if (res.ok) return res;

    if (res.status === 401 || res.status === 403) {
      // 401/403 → SmithError(permission-denied) via httpErrorFor.
      // fetchConfluencePages re-throws this to abort the page walk
      // (dead token; subsequent pages will fail identically).
      // See src/io/confluence.ts (page-walk catch).
      throw await httpErrorFor(res, {
        service: "Atlassian",
        url,
      });
    }

    lastStatus = res.status;
    const isRateLimited = res.status === 429;
    const isRetryable5xx = RETRYABLE_5XX.has(res.status);

    if (!isRateLimited && !isRetryable5xx) {
      // Non-retryable status — bubble through unchanged.
      return res;
    }

    // Need to re-read the body for an error message; capture before discarding.
    lastSnippet = await errorBodySnippet(res);

    if (attempt === MAX_ATTEMPTS) break;

    const baseMs = isRateLimited
      ? Math.min(parseRetryAfter(res.headers.get("retry-after")), RETRY_AFTER_CAP_MS)
      : BACKOFF_5XX_BASE_MS[attempt - 1]!;
    await sleep(jitter(baseMs, random));
  }

  if (lastStatus === 429) {
    const cleanSnippet = lastSnippet.replace(/^ \(|\)$/g, "");
    // Retry-exhaustion paths construct SmithError directly (no fresh Response
    // for httpErrorFor); apply the same URL redaction seam inline.
    throw new SmithError({
      code: "http-error",
      service: "Atlassian",
      status: 429,
      url: redactSecrets(url),
      operation: `rate-limited after ${MAX_ATTEMPTS} attempts`,
      ...(cleanSnippet ? { snippet: cleanSnippet } : {}),
    });
  }
  const cleanSnippet = lastSnippet.replace(/^ \(|\)$/g, "");
  throw new SmithError({
    code: "http-error",
    service: "Atlassian",
    status: lastStatus ?? 500,
    url: redactSecrets(url),
    operation: `unavailable after ${MAX_ATTEMPTS} attempts`,
    ...(cleanSnippet ? { snippet: cleanSnippet } : {}),
  });
}
