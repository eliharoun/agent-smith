import { SmithError } from "../core/smith-error";
import { redactSecrets } from "../core/redact";

export interface HttpErrorOpts {
  service: string;
  url: string;
  operation?: string;
  snippetMaxLen?: number;
}

const DEFAULT_SNIPPET_MAX = 200;

/**
 * Build a typed SmithError from a non-OK Response. Reads the body
 * defensively (returns no snippet on read failure or empty body). Maps
 * 401/403 to `permission-denied` (the payload variant best fits credential
 * issues); everything else maps to `http-error`.
 *
 * Pure function: returns a SmithError; the caller throws.
 *
 * URL is redacted via `redactSecrets` (strips `userinfo@` and known
 * secret-bearing query keys) before embedding in the SmithError payload.
 * Callers may pass URLs containing credentials or signed-URL signatures
 * without further sanitization.
 */
export async function httpErrorFor(
  res: Response,
  opts: HttpErrorOpts,
): Promise<SmithError> {
  const safeUrl = redactSecrets(opts.url);
  const snippetMaxLen = opts.snippetMaxLen ?? DEFAULT_SNIPPET_MAX;
  let snippet: string | undefined;
  try {
    const body = (await res.text()).trim();
    if (body.length > 0) {
      snippet = body.length > snippetMaxLen ? body.slice(0, snippetMaxLen) : body;
    }
  } catch {
    // Body already consumed or unreadable — leave snippet undefined.
  }

  if (res.status === 401 || res.status === 403) {
    return new SmithError({
      code: "permission-denied",
      path: safeUrl,
      operation: opts.operation ?? "read",
    });
  }

  return new SmithError({
    code: "http-error",
    service: opts.service,
    status: res.status,
    url: safeUrl,
    ...(opts.operation ? { operation: opts.operation } : {}),
    ...(snippet ? { snippet } : {}),
  });
}
