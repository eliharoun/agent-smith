import { describe, expect, test } from "bun:test";
import { buildSessionStartHook } from "../../src/io/claude-code-hook-shape";

type SessionStartEntry = { matcher: string; hooks: Array<{ command: string }> };

function extractCommand(hook: Record<string, unknown>): string {
  const sessionStart = hook.SessionStart as SessionStartEntry[];
  const entry = sessionStart[0];
  if (!entry) throw new Error("expected SessionStart entry");
  const inner = entry.hooks[0];
  if (!inner) throw new Error("expected inner hook entry");
  return inner.command;
}

describe("buildSessionStartHook", () => {
  test("returns an object with a SessionStart top-level key", () => {
    const hook = buildSessionStartHook("example-agent");
    expect(typeof hook).toBe("object");
    expect(Object.keys(hook)).toContain("SessionStart");
  });

  test("the hook command references smith knowledge refresh-session and the agent name", () => {
    const command = extractCommand(buildSessionStartHook("example-agent"));
    expect(command).toContain("smith knowledge refresh-session");
    expect(command).toContain("--agent example-agent");
  });

  test("different agent names produce different commands", () => {
    const cmdA = extractCommand(buildSessionStartHook("example-agent"));
    const cmdB = extractCommand(buildSessionStartHook("morpheus"));
    expect(cmdA).not.toBe(cmdB);
    expect(cmdA).toContain("example-agent");
    expect(cmdB).toContain("morpheus");
  });

  test("returns a new instance per call (no shared mutable state)", () => {
    const a = buildSessionStartHook("example-agent");
    const b = buildSessionStartHook("example-agent");
    expect(a).not.toBe(b);
    expect(a.SessionStart).not.toBe(b.SessionStart);
    // Mutating one must not affect the other.
    (a.SessionStart as unknown[]).push({ tampered: true });
    expect((b.SessionStart as unknown[]).length).toBe(1);
  });

  test("shape is byte-identical across calls for the same agent", () => {
    const a = buildSessionStartHook("example-agent");
    const b = buildSessionStartHook("example-agent");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
