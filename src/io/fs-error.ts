import { SmithError } from "../core/smith-error";

/**
 * Classify a filesystem error into a typed SmithError. Used by callers
 * whose behavior depends on whether a path was missing, unreadable, or
 * generically failed.
 *
 * - ENOENT          → not-found
 * - EACCES / EPERM  → permission-denied (read)
 * - other Error     → validation-failed with `${path}: ${message}` reason
 * - non-Error       → validation-failed with stringified reason
 *
 * JSON parse and validation errors are NOT handled here — callers should
 * use existing variants (registry-corrupt-json, validation-failed) directly.
 */
export function classifyFsError(
  err: unknown,
  path: string,
  operation: string,
): SmithError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return new SmithError({
      code: "not-found",
      what: operation,
      identifier: path,
    });
  }
  if (code === "EACCES" || code === "EPERM") {
    return new SmithError({
      code: "permission-denied",
      path,
      operation: "read",
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SmithError({
    code: "validation-failed",
    what: operation,
    reasons: [`${path}: ${message}`],
  });
}
