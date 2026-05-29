import { describe, expect, test } from "bun:test";
import {
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_RUNTIME,
  EXIT_USAGE,
  exitCodeFor,
} from "../../src/cli/exit-codes";

describe("exit-code constants", () => {
  test("constants match spec taxonomy", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_RUNTIME).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_PARTIAL).toBe(3);
  });
});

describe("exitCodeFor", () => {
  test("usage-error → 2", () => {
    expect(exitCodeFor("usage-error")).toBe(EXIT_USAGE);
  });

  test("validation-failed → 2", () => {
    expect(exitCodeFor("validation-failed")).toBe(EXIT_USAGE);
  });

  test("partial-failure → 3", () => {
    expect(exitCodeFor("partial-failure")).toBe(EXIT_PARTIAL);
  });

  test("registry-version → 1", () => {
    expect(exitCodeFor("registry-version")).toBe(EXIT_RUNTIME);
  });

  test("registry-corrupt-json → 1", () => {
    expect(exitCodeFor("registry-corrupt-json")).toBe(EXIT_RUNTIME);
  });

  test("skill-registry-version → 1", () => {
    expect(exitCodeFor("skill-registry-version")).toBe(EXIT_RUNTIME);
  });

  test("installed-skills-corrupt → 1", () => {
    expect(exitCodeFor("installed-skills-corrupt")).toBe(EXIT_RUNTIME);
  });

  test("config-missing → 2 (EXIT_USAGE per B12 — user hasn't run `smith init`)", () => {
    expect(exitCodeFor("config-missing")).toBe(EXIT_USAGE);
  });

  test("permission-denied → 1", () => {
    expect(exitCodeFor("permission-denied")).toBe(EXIT_RUNTIME);
  });

  test("not-found maps to EXIT_RUNTIME", () => {
    expect(exitCodeFor("not-found")).toBe(EXIT_RUNTIME);
  });

  test("already-exists → 2 (EXIT_USAGE per B12 — user asked to create something that exists)", () => {
    expect(exitCodeFor("already-exists")).toBe(EXIT_USAGE);
  });

  test("http-error maps to EXIT_RUNTIME (default)", () => {
    expect(exitCodeFor("http-error")).toBe(EXIT_RUNTIME);
  });
});
