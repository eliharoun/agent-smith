import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetWarnedForTesting, isDebug } from "../../src/cli/debug-flag";

/**
 * These tests mutate process.env. Each test snapshots the two flags it cares
 * about in `beforeEach`, restores them in `afterEach`, and resets the
 * module-level "warned" latch so the deprecation-warning assertions are
 * deterministic across tests.
 */

const ENV_KEYS = ["SMITH_DEBUG", "AGENT_SMITH_DEBUG"] as const;

let snapshot: Record<string, string | undefined> = {};
let warnings: string[];
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
  _resetWarnedForTesting();
  warnings = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  // Capture anything written to stderr during the test.
  process.stderr.write = ((chunk: unknown) => {
    warnings.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
  for (const k of ENV_KEYS) {
    const v = snapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetWarnedForTesting();
});

describe("isDebug() — SMITH_DEBUG truthiness", () => {
  test("returns false when both env vars are unset", () => {
    expect(isDebug()).toBe(false);
  });

  test("returns true for SMITH_DEBUG=1", () => {
    process.env.SMITH_DEBUG = "1";
    expect(isDebug()).toBe(true);
  });

  test("returns true for SMITH_DEBUG=true (case-insensitive)", () => {
    for (const v of ["true", "True", "TRUE"]) {
      process.env.SMITH_DEBUG = v;
      expect(isDebug()).toBe(true);
    }
  });

  test("returns true for SMITH_DEBUG=yes", () => {
    process.env.SMITH_DEBUG = "yes";
    expect(isDebug()).toBe(true);
  });

  test("returns false for SMITH_DEBUG=0", () => {
    process.env.SMITH_DEBUG = "0";
    expect(isDebug()).toBe(false);
  });

  test("returns false for SMITH_DEBUG=false", () => {
    process.env.SMITH_DEBUG = "false";
    expect(isDebug()).toBe(false);
  });

  test("returns false for SMITH_DEBUG= (empty string)", () => {
    process.env.SMITH_DEBUG = "";
    expect(isDebug()).toBe(false);
  });

  test("returns false for SMITH_DEBUG=anything-else", () => {
    process.env.SMITH_DEBUG = "anything-else";
    expect(isDebug()).toBe(false);
  });
});

describe("isDebug() — AGENT_SMITH_DEBUG deprecation alias", () => {
  test("returns true for AGENT_SMITH_DEBUG=1 when SMITH_DEBUG is unset, and warns exactly once", () => {
    process.env.AGENT_SMITH_DEBUG = "1";
    expect(isDebug()).toBe(true);
    expect(isDebug()).toBe(true);
    expect(isDebug()).toBe(true);
    const deprecationLines = warnings.filter((w) =>
      w.includes("AGENT_SMITH_DEBUG"),
    );
    expect(deprecationLines.length).toBe(1);
  });

  test("returns true for SMITH_DEBUG=1 regardless of AGENT_SMITH_DEBUG, and does NOT warn when SMITH_DEBUG is the active source", () => {
    process.env.SMITH_DEBUG = "1";
    process.env.AGENT_SMITH_DEBUG = "1";
    expect(isDebug()).toBe(true);
    expect(isDebug()).toBe(true);
    const deprecationLines = warnings.filter((w) =>
      w.includes("AGENT_SMITH_DEBUG"),
    );
    expect(deprecationLines.length).toBe(0);
  });

  test("deprecation warning text mentions both AGENT_SMITH_DEBUG (deprecated) and SMITH_DEBUG (replacement)", () => {
    process.env.AGENT_SMITH_DEBUG = "1";
    isDebug();
    const joined = warnings.join("");
    expect(joined).toContain("AGENT_SMITH_DEBUG is deprecated");
    expect(joined).toContain("SMITH_DEBUG");
  });
});
