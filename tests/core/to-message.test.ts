/**
 * Tests for `toMessage(err)`: a narrowing helper that replaces the
 * unsafe pattern `(err as Error).message`. Catch handlers receive
 * `unknown`; nothing prevents callers from throwing strings, plain
 * objects, `undefined`, or anything else. The unsafe cast produces
 * the literal string `"undefined"` in those cases, which then leaks
 * into user-facing error output. Theme G of the 2026-05-04 error
 * audit catalogues 20 sites where this leaks.
 */
import { describe, expect, test } from "bun:test";
import { toMessage } from "../../src/core/to-message";

describe("toMessage", () => {
  test("returns Error.message for Error instances", () => {
    expect(toMessage(new Error("boom"))).toBe("boom");
  });

  test("returns Error.message for Error subclasses", () => {
    class MyError extends Error {}
    expect(toMessage(new MyError("subclassed"))).toBe("subclassed");
  });

  test("returns the string itself for thrown strings", () => {
    expect(toMessage("just a string")).toBe("just a string");
  });

  test("returns 'undefined' string for undefined throw (not the literal token)", () => {
    // Note: `String(undefined) === "undefined"`, which is intentional —
    // the goal is to never crash and never return literally the wrong
    // field, not to invent a friendly message. The audit's concern is
    // that `(undefined as Error).message` *also* yields "undefined" but
    // by a much spookier route.
    expect(toMessage(undefined)).toBe("undefined");
  });

  test("returns 'null' string for null throw", () => {
    expect(toMessage(null)).toBe("null");
  });

  test("stringifies thrown numbers", () => {
    expect(toMessage(42)).toBe("42");
  });

  test("stringifies thrown booleans", () => {
    expect(toMessage(false)).toBe("false");
  });

  test("uses String() coercion for plain objects (yields '[object Object]')", () => {
    // We intentionally do NOT JSON.stringify here: thrown objects with
    // cyclic references would crash the helper, defeating its purpose
    // (safe extraction). Callers that want richer formatting should
    // narrow themselves before calling.
    expect(toMessage({ a: 1 })).toBe("[object Object]");
  });

  test("uses object's own toString when defined", () => {
    const obj = {
      toString() {
        return "custom-string";
      },
    };
    expect(toMessage(obj)).toBe("custom-string");
  });

  test("does not throw on objects with a getter that throws", () => {
    const evil = {
      get message() {
        throw new Error("nope");
      },
      toString() {
        return "fallback";
      },
    };
    // Must not propagate — the whole point of this helper is to never
    // make error handling itself throw.
    expect(() => toMessage(evil)).not.toThrow();
    expect(toMessage(evil)).toBe("fallback");
  });

  test("falls back to a sentinel when stringification itself throws", () => {
    // Symbols cannot be implicitly converted to strings via template
    // literals or `String(x) + ""` in some paths — `String(symbol)`
    // works, but a custom toString that throws will. We accept a
    // sentinel rather than re-throwing.
    const evil = {
      toString() {
        throw new Error("nope");
      },
    };
    const out = toMessage(evil);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
