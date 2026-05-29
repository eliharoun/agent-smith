import type { SmithErrorCode } from "../core/smith-error";

/**
 * Exit code taxonomy. Single source of truth — every command and the wrap()
 * shim use these constants instead of bare integer literals. See spec
 * §"Exit code taxonomy" for the contract.
 */
export const EXIT_OK = 0;
export const EXIT_RUNTIME = 1;
export const EXIT_USAGE = 2;
export const EXIT_PARTIAL = 3;

export type SmithExitCode = 0 | 1 | 2 | 3;

/**
 * Map a SmithError code to its process exit code. Default is EXIT_RUNTIME
 * — codes for catalog-file/state/system problems all signal "operation
 * could not complete" (1). Usage/validation (2), partial-failure (3),
 * and per-code usage problems deviate. See `docs/v1-surface-exit-codes.md`
 * for the v1 contract.
 */
export function exitCodeFor(code: SmithErrorCode): SmithExitCode {
  switch (code) {
    case "usage-error":
    case "validation-failed":
    case "already-exists":
    case "config-missing":
      // already-exists: user asked to create something that exists.
      // config-missing: user hasn't run `smith init` (usage prerequisite).
      return EXIT_USAGE;
    case "partial-failure":
      return EXIT_PARTIAL;
    default:
      return EXIT_RUNTIME;
  }
}
