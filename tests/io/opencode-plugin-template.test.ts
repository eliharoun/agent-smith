import { describe, expect, test } from "bun:test";
import { renderOpencodePlugin } from "../../src/io/opencode-plugin-template";

describe("renderOpencodePlugin", () => {
  test("includes session.created listener invoking smith refresh-session", () => {
    const ts = renderOpencodePlugin();
    expect(ts).toContain('"session.created"');
    expect(ts).toContain("smith knowledge refresh-session --platform opencode");
  });

  test("wraps the invocation in try/catch (soft-fail)", () => {
    const ts = renderOpencodePlugin();
    expect(ts).toMatch(/try\s*\{[\s\S]*?\}\s*catch/);
  });

  test("has a 5s timeout", () => {
    const ts = renderOpencodePlugin();
    expect(ts).toMatch(/timeout\(5000\)|timeout:\s*5000/);
  });

  test("output is deterministic (no timestamps/random)", () => {
    expect(renderOpencodePlugin()).toBe(renderOpencodePlugin());
  });
});
