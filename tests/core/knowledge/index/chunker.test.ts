import { describe, expect, it } from "bun:test";
import { CHUNKER_VERSION, chunk, kindForPath } from "../../../../src/core/knowledge/index/chunker";

describe("chunker", () => {
  it("splits prose on markdown headings with line ranges", async () => {
    const out = await chunk({ relPath: "doc.md", text: "# A\nalpha\n\n# B\nbeta\n" });
    expect(out.length).toBe(2);
    expect(out[0]?.kind).toBe("prose");
    expect(out[0]?.startLine).toBe(1);
    expect(out[1]?.text).toContain("beta");
  });
  it("splits JSON on top-level keys", async () => {
    const out = await chunk({
      relPath: "x.json",
      text: JSON.stringify({ one: 1, two: { a: 2 } }, null, 2),
    });
    expect(out.every((c) => c.kind === "json")).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
  it("code: prepends a path/symbol context header to each chunk", async () => {
    const out = await chunk({
      relPath: "f.ts",
      text: "export function foo(){return 1}\nexport function bar(){return 2}\n",
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.text.startsWith("// f.ts")).toBe(true);
  });
  it("CHUNKER_VERSION is a stable integer", () => {
    expect(Number.isInteger(CHUNKER_VERSION)).toBe(true);
  });
  it("kindForPath mirrors the extension-based dispatch", () => {
    expect(kindForPath("a.ts")).toBe("code");
    expect(kindForPath("a.py")).toBe("code");
    expect(kindForPath("README.md")).toBe("prose");
    expect(kindForPath("data.json")).toBe("json");
    expect(kindForPath("Makefile")).toBe("prose");
  });
  it("does not throw on bare-primitive JSON (null, string, number)", async () => {
    for (const text of ["null", '"hello world"', "42"]) {
      const out = await chunk({ relPath: "p.json", text });
      expect(Array.isArray(out)).toBe(true); // degrades to prose-as-json, never throws
      expect(out.every((c) => c.kind === "json")).toBe(true);
    }
  });
});
