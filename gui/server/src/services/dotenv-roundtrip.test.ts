import { describe, expect, it } from "bun:test";
import { parseEnvFile, upsertEnvLines } from "./dotenv-roundtrip";

describe("parseEnvFile", () => {
  it("parses simple KEY=VALUE pairs", () => {
    expect(parseEnvFile("A=1\nB=two\n")).toEqual({ A: "1", B: "two" });
  });
  it("ignores comments and blanks", () => {
    expect(parseEnvFile("# c\n\nA=1\n")).toEqual({ A: "1" });
  });
  it("unquotes double-quoted values", () => {
    expect(parseEnvFile('A="hello world"\n')).toEqual({ A: "hello world" });
  });
});

describe("upsertEnvLines", () => {
  it("updates an existing key in place", () => {
    const out = upsertEnvLines("# top\nFOO=old\nBAR=keep\n", { FOO: "new" });
    expect(out).toContain("# top");
    expect(out).toContain("FOO=new");
    expect(out).not.toContain("FOO=old");
    expect(out).toContain("BAR=keep");
  });
  it("appends a missing key", () => {
    const out = upsertEnvLines("FOO=1\n", { BAR: "2" });
    expect(out).toContain("FOO=1");
    expect(out).toContain("BAR=2");
  });
  it("preserves comments and unknown keys", () => {
    const raw = "# header\nKEEP=me\n# mid\nFOO=old\n";
    const out = upsertEnvLines(raw, { FOO: "new", NEW: "val" });
    expect(out).toContain("# header");
    expect(out).toContain("# mid");
    expect(out).toContain("KEEP=me");
    expect(out).toContain("FOO=new");
    expect(out).toContain("NEW=val");
  });
  it("quotes values containing whitespace or #", () => {
    const out = upsertEnvLines("", { A: "hello world", B: "x#y" });
    expect(out).toContain('A="hello world"');
    expect(out).toContain('B="x#y"');
  });
  it("removes a key when value is null", () => {
    const out = upsertEnvLines("A=1\nB=2\n", { A: null });
    expect(out).not.toMatch(/^A=/m);
    expect(out).toContain("B=2");
  });
  it("treats input with no trailing newline correctly", () => {
    const out = upsertEnvLines("A=1", { B: "2" });
    expect(out).toContain("A=1");
    expect(out).toContain("B=2");
  });
  it("preserves trailing newline on existing files", () => {
    const out = upsertEnvLines("A=1\n", { B: "2" });
    expect(out.endsWith("\n")).toBe(true);
  });
});
