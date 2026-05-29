import { describe, expect, test } from "bun:test";
import { assertValidAgentName, KEBAB_AGENT_NAME } from "../../src/cli/agent-name";
import { SmithError } from "../../src/core/smith-error";

/**
 * Unit tests for the CLI-boundary agent-name guard. See the file-header
 * comment in src/cli/agent-name.ts for the rationale.
 */
describe("KEBAB_AGENT_NAME", () => {
  test("accepts well-formed kebab names", () => {
    for (const n of ["a", "ab", "a1", "a-b", "my-agent", "code-reviewer-2", "agent1-foo2"]) {
      expect(KEBAB_AGENT_NAME.test(n)).toBe(true);
    }
  });
  test("rejects malformed kebab names", () => {
    for (const n of ["", "1a", "-a", "a-", "a--b", "A", "aB", "a_b", "a.b", "a/b"]) {
      expect(KEBAB_AGENT_NAME.test(n)).toBe(false);
    }
  });
});

describe("assertValidAgentName", () => {
  test("accepts valid kebab names without throwing", () => {
    for (const n of ["a", "my-agent", "code-reviewer", "agent1", "x-y-z"]) {
      expect(() => assertValidAgentName(n)).not.toThrow();
    }
  });

  function expectFail(name: string, expectedReasonSubstr: string): SmithError {
    let caught: unknown;
    try {
      assertValidAgentName(name);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const sm = caught as SmithError;
    expect(sm.payload.code).toBe("validation-failed");
    const payload = sm.payload as { what: string; reasons: string[] };
    expect(payload.what).toBe(`agent name "${name}"`);
    expect(payload.reasons.length).toBeGreaterThan(0);
    expect(payload.reasons.join(" | ")).toContain(expectedReasonSubstr);
    return sm;
  }

  test("rejects empty string", () => {
    expectFail("", "must not be empty");
  });
  test("rejects forward slash (traversal)", () => {
    expectFail("../etc", "/");
    expectFail("a/b", "/");
    expectFail("/abs/path", "/");
  });
  test("rejects backslash", () => {
    expectFail("a\\b", "\\");
  });
  test("rejects NUL byte", () => {
    expectFail("a\0b", "NUL");
  });
  test("rejects names starting with '.'", () => {
    expectFail(".hidden", ".");
    expectFail("..", ".");
  });
  test("rejects non-kebab shapes (uppercase, underscore, etc.)", () => {
    expectFail("BadCase", "kebab-case");
    expectFail("my_agent", "kebab-case");
    expectFail("1agent", "kebab-case");
    expectFail("-agent", "kebab-case");
    expectFail("agent-", "kebab-case");
    expectFail("agent--name", "kebab-case");
  });

  test("custom `what` label appears verbatim in payload", () => {
    let caught: unknown;
    try {
      assertValidAgentName("../bad", "--from source");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload as { what: string };
    expect(payload.what).toBe(`--from source "../bad"`);
  });
});
