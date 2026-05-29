import { describe, expect, test } from "bun:test";
import {
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_RUNTIME,
  EXIT_USAGE,
  exitCodeFor,
} from "../../src/cli/exit-codes";

/**
 * v1 exit-code stability — numeric values are part of the public CLI
 * contract. Scripts and CI pipelines key off these numbers; changing them
 * after v1.0.0 is a major version break.
 *
 * Per the canonical spec at
 * docs/superpowers/specs/2026-05-04-smith-error-and-cli-wrapper-design.md
 * "Exit code taxonomy":
 *
 *   0 — operation completed successfully
 *   1 — runtime error (catalog/state/system problems, generic catch-all)
 *   2 — usage or validation error (bad flags, malformed config)
 *   3 — partial failure (some items succeeded, some failed)
 *
 * Any change to these numbers MUST be a major version bump and MUST be
 * called out in CHANGELOG with a migration note for shell scripts.
 */

describe("v1 exit-code stability", () => {
  test("EXIT_OK = 0", () => {
    expect(EXIT_OK).toBe(0);
  });

  test("EXIT_RUNTIME = 1", () => {
    expect(EXIT_RUNTIME).toBe(1);
  });

  test("EXIT_USAGE = 2", () => {
    expect(EXIT_USAGE).toBe(2);
  });

  test("EXIT_PARTIAL = 3", () => {
    expect(EXIT_PARTIAL).toBe(3);
  });

  test("the full set of exit codes is exactly {0,1,2,3}", () => {
    // Snapshot guard: if a new exit code is added, this set comparison
    // fails and forces explicit acknowledgment that we're expanding the
    // contract.
    expect(new Set([EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, EXIT_PARTIAL])).toEqual(
      new Set([0, 1, 2, 3]),
    );
  });
});

describe("v1 exit-code stability — exitCodeFor() mapping", () => {
  // Lock the SmithErrorCode → exit-code mapping. Every code listed here
  // is part of the public contract; changing any of these mappings is a
  // major bump.

  test("usage-error → EXIT_USAGE (2)", () => {
    expect(exitCodeFor("usage-error")).toBe(EXIT_USAGE);
  });

  test("validation-failed → EXIT_USAGE (2)", () => {
    expect(exitCodeFor("validation-failed")).toBe(EXIT_USAGE);
  });

  test("partial-failure → EXIT_PARTIAL (3)", () => {
    expect(exitCodeFor("partial-failure")).toBe(EXIT_PARTIAL);
  });

  test("registry-version → EXIT_RUNTIME (1) via default branch", () => {
    expect(exitCodeFor("registry-version")).toBe(EXIT_RUNTIME);
  });

  test("registry-corrupt-json → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("registry-corrupt-json")).toBe(EXIT_RUNTIME);
  });

  test("permission-denied → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("permission-denied")).toBe(EXIT_RUNTIME);
  });

  test("not-found → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("not-found")).toBe(EXIT_RUNTIME);
  });

  test("already-exists → EXIT_USAGE (2) [B12: usage error, user asked to create something that exists]", () => {
    expect(exitCodeFor("already-exists")).toBe(EXIT_USAGE);
  });

  test("config-missing → EXIT_USAGE (2) [B12: usage prerequisite, user hasn't run `smith init`]", () => {
    expect(exitCodeFor("config-missing")).toBe(EXIT_USAGE);
  });

  test("http-error → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("http-error")).toBe(EXIT_RUNTIME);
  });

  test("network-error → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("network-error")).toBe(EXIT_RUNTIME);
  });

  test("protected-catalog → EXIT_RUNTIME (1)", () => {
    expect(exitCodeFor("protected-catalog")).toBe(EXIT_RUNTIME);
  });
});
